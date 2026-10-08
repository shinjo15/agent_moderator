import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { confirmUsage } from './fixtures/confirm-usage';
import { apiResponse } from '../tests/fixtures/jev';
declare const chrome: {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  tabs: { create(options: { url: string; active: boolean }): Promise<{ id: number }> };
  storage: {
    local: { get(keys: string[]): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void> };
    session: { set(values: Record<string, unknown>): Promise<void> };
  };
};

test('MV3 background: 旧runtime/旧版/読取・保存失敗は通信0、Jev有効化済みでも送信直前の確認読取失敗を拒否', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-confirmation-boundary-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    let youtubeCalls = 0; let jevCalls = 0;
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>閲覧fixture</body>' }));
    await context.route('https://www.googleapis.com/youtube/v3/**', route => {
      youtubeCalls++;
      return route.fulfill({ json: route.request().url().includes('/videos?')
        ? { items: [{ id: 'abcdefghijk', liveStreamingDetails: { activeLiveChatId: 'fixture-chat' } }] }
        : { nextPageToken: 'next', pollingIntervalMillis: 5000, items: [{ id: 'pending-post', snippet: {
          type: 'textMessageEvent', hasDisplayContent: true, displayMessage: '未送信本文fixture', publishedAt: new Date().toISOString(),
        }, authorDetails: { channelId: 'UCabcdefghijklmnopqrstuv' } }] } });
    });
    await context.route('https://api.typesafe.ai/v1/systemone', route => { jevCalls++; return route.fulfill({ json: apiResponse() }); });
    const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
    for (const provider of ['YouTube', 'Jev']) {
      await options.getByLabel(`${provider} APIキー`).fill(`synthetic-${provider}`);
      await options.getByRole('button', { name: `${provider}キーを保存`, exact: true }).click();
      await expect(options.getByLabel(`${provider} APIキー`)).toHaveValue('');
    }
    // Intentionally seed only the session binding: exercise old runtime requests without new UI checks.
    const watchOpened = context.waitForEvent('page');
    const target = await worker.evaluate(() => chrome.tabs.create({ url: 'https://www.youtube.com/watch?v=abcdefghijk', active: false }));
    await watchOpened;
    const monitorOpened = context.waitForEvent('page');
    await worker.evaluate(async targetTabId => {
      const monitor = await chrome.tabs.create({ url: 'about:blank', active: false });
      await chrome.storage.session.set({ 'youtube.monitorBinding': { monitorTabId: monitor.id, targetTabId, videoId: 'abcdefghijk' } });
    }, target.id);
    const monitor = await monitorOpened; await monitor.goto(`chrome-extension://${id}/monitor.html`);
    await expect(monitor.getByRole('button', { name: '取得を開始', exact: true })).toBeEnabled();
    for (const value of [undefined, { version: 0 }, { version: '1' }]) {
      if (value !== undefined) await worker.evaluate(value => chrome.storage.local.set({ 'usage.confirmation': value }), value);
      expect(await monitor.evaluate(() => chrome.runtime.sendMessage({ type: 'youtube.resolve', requestId: 'legacy', videoId: 'abcdefghijk' })))
        .toMatchObject({ ok: false, error: { code: 'confirmationRequired' } });
      expect(await monitor.evaluate(() => chrome.runtime.sendMessage({ type: 'jev.enable' })))
        .toMatchObject({ ok: false, error: { code: 'confirmationRequired' } });
    }
    expect(youtubeCalls).toBe(0); expect(jevCalls).toBe(0);
    await worker.evaluate(() => {
      const original = chrome.storage.local.set.bind(chrome.storage.local);
      Object.assign(globalThis, { restoreConfirmationWrite: () => { chrome.storage.local.set = original; } });
      chrome.storage.local.set = async values => { if ('usage.confirmation' in values) throw new Error('private-write-error'); return original(values); };
    });
    await options.getByLabel('利用条件・データの扱いを確認しました', { exact: true }).check();
    await options.getByRole('button', { name: '利用条件の確認を保存', exact: true }).click();
    await expect(options.getByTestId('confirmation-status')).toContainText('保存・取得できませんでした');
    expect(await monitor.evaluate(() => chrome.runtime.sendMessage({ type: 'youtube.resolve', requestId: 'failed-save', videoId: 'abcdefghijk' })))
      .toMatchObject({ ok: false });
    expect(youtubeCalls).toBe(0); expect(jevCalls).toBe(0);
    await worker.evaluate(() => (globalThis as unknown as { restoreConfirmationWrite(): void }).restoreConfirmationWrite());
    await confirmUsage(options);
    expect(await monitor.evaluate(() => chrome.runtime.sendMessage({ type: 'jev.enable' }))).toEqual({ ok: true });
    expect(await monitor.evaluate(() => chrome.runtime.sendMessage({ type: 'youtube.resolve', requestId: 'confirmed', videoId: 'abcdefghijk' }))).toMatchObject({ ok: true });
    // Test-only cooldown reset avoids a real-time sleep; production cooldown regressions are separate.
    await worker.evaluate(() => chrome.storage.session.set({ 'youtube.cooldown': { interval: 5000, notBefore: 0 } }));
    expect(await monitor.evaluate(() => chrome.runtime.sendMessage({ type: 'youtube.list', requestId: 'observed', liveChatId: 'fixture-chat' }))).toMatchObject({ ok: true });
    expect(youtubeCalls).toBe(2); expect(jevCalls).toBe(0);
    await worker.evaluate(() => {
      const original = chrome.storage.local.get.bind(chrome.storage.local);
      chrome.storage.local.get = async keys => { if (keys.includes('usage.confirmation')) throw new Error('private-read-error'); return original(keys); };
    });
    expect(await monitor.evaluate(() => chrome.runtime.sendMessage({ type: 'jev.evaluate', id: 'pending-post' })))
      .toMatchObject({ ok: true, value: { jev: 'failed', error: { code: 'confirmationRequired' } } });
    expect(await monitor.evaluate(() => chrome.runtime.sendMessage({ type: 'youtube.resolve', requestId: 'read-failed', videoId: 'abcdefghijk' }))).toMatchObject({ ok: false });
    expect(youtubeCalls).toBe(2); expect(jevCalls).toBe(0);
    await expect(options.locator('body')).not.toContainText('private-write-error');
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
