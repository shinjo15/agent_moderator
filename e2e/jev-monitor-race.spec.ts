import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
type Sender = { id?: string; url?: string };
declare const chrome: { runtime: { id: string; getURL(path: string): string; sendMessage(message: unknown): Promise<unknown>; onMessage: { addListener(listener: (message: unknown, sender: Sender) => boolean): void } } };
declare const jevRace: { evaluate(): Promise<unknown>; release(value: unknown): Promise<void>; notify(): void };
for (const scenario of ['oldDisabled', 'stop', 'keyChange'] as const) {
  test(`production monitor UI: Jev遅延応答 ${scenario} は有効化/停止の新状態を上書きしない`, async () => {
    const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-jev-ui-race-'));
    const extension = resolve('dist');
    const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const id = new URL(worker.url()).hostname;
      const page = await context.newPage();
      await page.addInitScript(() => {
        let listener!: (message: unknown, sender: Sender) => boolean;
        let finish!: (value: unknown) => void;
        const pending = new Promise(resolve => { finish = resolve; });
        chrome.runtime.onMessage.addListener = value => { listener = value; };
        chrome.runtime.sendMessage = async message => {
          const value = message as { type: string };
          if (value.type === 'youtube.status') return { ok: true, value: { videoId: 'abcdefghijk', credentialsAvailable: true } };
          if (value.type === 'youtube.resolve') return { ok: true, value: { liveChatId: 'fixture' } };
          if (value.type === 'youtube.list') return { ok: true, value: { messages: [{ id: 'one', authorChannelId: 'author', text: '批判fixture', type: 'textMessageEvent' }], nextPageToken: 'next', pollingIntervalMillis: 5000, ended: false } };
          if (value.type === 'jev.evaluate') return pending;
          return { ok: true };
        };
        Object.assign(globalThis, { jevRace: {
          evaluate: () => pending,
          async release(value: unknown) { finish(value); await pending; },
          notify() { listener({ type: 'jev.credentialsChanged' }, { id: chrome.runtime.id, url: chrome.runtime.getURL('background.js') }); },
        } });
      });
      await page.goto(`chrome-extension://${id}/monitor.html`);
      await expect(page.getByRole('button', { name: '取得を開始', exact: true })).toBeEnabled();
      if (scenario !== 'oldDisabled') await page.getByRole('button', { name: 'Jev判定を有効化・再開' }).click();
      await page.getByRole('button', { name: '取得を開始', exact: true }).click();
      await expect(page.locator('#messages li')).toHaveCount(1, { timeout: 12000 });
      if (scenario === 'oldDisabled') await page.getByRole('button', { name: 'Jev判定を有効化・再開' }).click();
      else if (scenario === 'stop') await page.getByRole('button', { name: 'Jev判定を停止', exact: true }).click();
      else await page.evaluate(() => jevRace.notify());
      const before = await page.getByTestId('jev-status').textContent();
      await page.evaluate(scenario => jevRace.release({ ok: true, value: { id: 'one', authorChannelId: 'author', burst: scenario === 'oldDisabled' ? 'notObserved' : 'confirmed',
        jev: 'disabled', reasons: scenario === 'oldDisabled' ? [] : ['burst'], ...(scenario === 'oldDisabled' ? {} : { malicious: true }) } }), scenario);
      await expect(page.locator('#messages li')).not.toContainText('悪質');
      await expect(page.getByTestId('jev-status')).toHaveText(before!);
      await page.getByRole('button', { name: '取得を停止', exact: true }).click();
    } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
  });
}
