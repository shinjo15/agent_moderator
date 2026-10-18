import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

declare const chrome: { i18n: { getUILanguage(): string }; runtime: { sendMessage(message: unknown): Promise<unknown> } };
for (const locale of ['ja', 'en']) {
  test(`overflowの原因と未判定・60秒再開案内を${locale}で維持する`, async () => {
    const profile = await mkdtemp(join(tmpdir(), 'moderator-overflow-'));
    const extension = resolve('dist');
    const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, locale,
      env: { ...process.env, LANGUAGE: locale, LANG: `${locale}.UTF-8` },
      args: [`--lang=${locale}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      expect(await worker.evaluate(() => chrome.i18n.getUILanguage())).toMatch(new RegExp(`^${locale}(-|$)`));
      const page = await context.newPage();
      await page.clock.install();
      await page.addInitScript(() => {
        chrome.runtime.sendMessage = async message => {
          const request = message as { type: string };
          if (request.type === 'youtube.status') return { ok: true, value: { videoId: 'abcdefghijk', credentialsAvailable: true } };
          if (request.type === 'youtube.resolve') return { ok: true, value: { liveChatId: 'fixture' } };
          if (request.type === 'youtube.list') return { ok: true, value: { messages: Array.from({ length: 10001 }, (_, i) => ({ id: `overflow-${i}`, authorChannelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', text: '投稿本文', type: 'textMessageEvent' })), nextPageToken: 'next', pollingIntervalMillis: 5000, ended: false } };
          if (request.type === 'hidden.list') return { ok: true, videoId: 'abcdefghijk', ids: [] };
          return { ok: false };
        };
      });
      await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/monitor.html`);
      await page.getByRole('button', { name: locale === 'ja' ? '取得を開始' : 'Start collection', exact: true }).click();
      await page.clock.runFor(5100);
      await expect(page.getByRole('status')).toHaveText(locale === 'ja'
        ? 'コメントが多く、取得を停止しました。未処理のコメントは未判定です。60秒後に「取得を開始」を押してください。'
        : 'Collection stopped because there are too many comments. Unprocessed comments are not evaluated. Press Start collection after 60 seconds.');
    } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
  });
}
