import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

type Listener = (message: unknown, sender: { id?: string; url?: string }) => boolean;
declare const chrome: { runtime: {
  id: string; getURL(path: string): string;
  sendMessage(message: unknown): Promise<unknown>;
  onMessage: { addListener(listener: Listener): void };
} };
declare const monitorRace: {
  notify(message: unknown, nextStatus?: unknown): void;
  finishStatus(response: unknown): Promise<void>;
};

for (const [type, responseFails] of [
  ['youtube.targetChanged', false], ['youtube.targetChanged', true],
  ['youtube.credentialsChanged', false], ['youtube.credentialsChanged', true],
] as const) {
  test(`${type}通知後の古い初期status${responseFails ? '失敗' : '成功'}応答はmonitor状態を戻さない`, async () => {
    const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-monitor-race-'));
    const extension = resolve('dist');
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const id = new URL(worker.url()).hostname;
      const page = await context.newPage();
      // Initial status is delayed; later selections have independent responses.
      // The DOM and production monitor.js/core are real; no API is called.
      await page.addInitScript(() => {
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        const add = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
        let listener!: Listener;
        let complete!: (response: unknown) => void;
        const initial = new Promise<unknown>(resolve => { complete = resolve; });
        let statusCalls = 0;
        let nextStatus: unknown = { ok: false, error: { code: 'forbidden' } };
        chrome.runtime.sendMessage = message => {
          if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'youtube.status') {
            return ++statusCalls === 1 ? initial : Promise.resolve(nextStatus);
          }
          return send(message);
        };
        chrome.runtime.onMessage.addListener = value => { listener = value; add(value); };
        Object.assign(globalThis, { monitorRace: {
          notify(message: unknown, response?: unknown) {
            nextStatus = response ?? { ok: false, error: { code: 'forbidden' } };
            listener(message, { id: chrome.runtime.id, url: chrome.runtime.getURL('background.js') });
          },
          async finishStatus(response: unknown) { complete(response); await initial; },
        } });
      });
      await page.goto(`chrome-extension://${id}/monitor.html`);
      await expect(page.getByRole('heading', { name: '独立チャットビューアー · YouTube Live' })).toBeVisible();
      await page.evaluate(type => monitorRace.notify({ type, available: false }), type);
      if (type === 'youtube.targetChanged') await expect(page.getByRole('status'))
        .toHaveText('YouTube視聴タブの拡張ポップアップから対象動画を選択してください。');
      await expect(page.getByRole('button', { name: '取得を開始' })).toBeDisabled();
      const before = await page.locator('main').textContent();
      await page.evaluate(response => monitorRace.finishStatus(response), responseFails
        ? { ok: false, error: { code: 'network' } }
        : { ok: true, value: { videoId: 'abcdefghijk', credentialsAvailable: true } });
      await expect(page.getByRole('button', { name: '取得を開始' })).toBeDisabled();
      expect(await page.locator('main').textContent()).toBe(before);
      if (type === 'youtube.targetChanged') {
        await page.evaluate(() => monitorRace.notify({ type: 'youtube.targetChanged' }, {
          ok: true, value: { videoId: 'zyxwvutsrqp', credentialsAvailable: true, paused: true },
        }));
        await expect(page.getByRole('button', { name: '取得を開始' })).toBeEnabled();
        await expect(page.getByRole('button', { name: '取得を停止', exact: true })).toBeDisabled();
        await expect(page.locator('.viewer-header')).toContainText('zyxwvutsrqp');
        await expect(page.locator('.viewer-header')).not.toContainText('abcdefghijk');
      }
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true });
    }
  });
}
