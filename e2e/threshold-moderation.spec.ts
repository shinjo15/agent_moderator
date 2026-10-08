import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { apiResponse } from '../tests/fixtures/jev';
import { confirmUsage } from './fixtures/confirm-usage';
declare const chrome: { tabs: { create(options: { url: string; active: boolean }): Promise<unknown> }; runtime: { sendMessage(message: unknown): Promise<unknown> } };
const video = 'abcdefghijk';
const cases = [
  { threshold: 0.65, score: 0.7, malicious: true },
  { threshold: 0.9, score: 0.85, malicious: false },
  { threshold: 0, score: 0, malicious: true },
  { threshold: 1, score: 0.999, malicious: false },
  { threshold: 1, score: 1, malicious: true },
];
const authors = cases.map((_, index) => `UC${String.fromCharCode(97 + index).repeat(22)}`);

test('MV3 threshold: 実policy/runtime/非表示・0/1・遅延snapshot/cached・設定変更は新評価だけで追加APIなし', async () => {
  test.setTimeout(90000);
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-threshold-path-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body:
      route.request().url().includes('/live_chat') ? `<!doctype html><body><script>
      ${authors.map((author, index) => `{const e=document.createElement('yt-live-chat-text-message-renderer');e.id='author-${index}';e.textContent='fixture-${index}';e.data={authorExternalChannelId:'${author}'};document.body.append(e);}`).join('\n')}
      </script></body>` : '<!doctype html><iframe src="https://www.youtube.com/live_chat?continuation=fixture"></iframe>' }));
    let index = 0;
    let calls = 0;
    await context.route('https://www.googleapis.com/youtube/v3/**', route => {
      const url = new URL(route.request().url());
      return route.fulfill({ json: url.pathname.endsWith('/videos') ? { items: [{ id: video, liveStreamingDetails: { activeLiveChatId: 'fixture-chat' } }] }
        : { nextPageToken: `next-${index}`, pollingIntervalMillis: 5000, items: [{ id: `post-${index}`, snippet: { type: 'textMessageEvent', hasDisplayContent: true,
          displayMessage: `API fixture ${index}`, publishedAt: new Date().toISOString() }, authorDetails: { channelId: authors[index] } }] } });
    });
    let release!: () => void;
    await context.route('https://api.typesafe.ai/v1/systemone', async route => {
      const current = index; calls++;
      expect(JSON.stringify(route.request().postDataJSON())).not.toContain('threshold');
      expect(Object.keys(route.request().postDataJSON().questions)).toHaveLength(7);
      if (current === 0) await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ json: apiResponse({ attack: cases[current].score }) });
    });
    const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
    await confirmUsage(options);
    for (const provider of ['YouTube', 'Jev']) {
      await options.getByLabel(`${provider} APIキー`).fill(`synthetic-${provider}`);
      await options.getByRole('button', { name: `${provider}キーを保存`, exact: true }).click();
      await expect(options.getByLabel(`${provider} APIキー`)).toHaveValue('');
    }
    const youtube = await context.newPage(); await youtube.goto(`https://www.youtube.com/watch?v=${video}`);
    await youtube.bringToFront();
    const cdp = await context.browser()!.newBrowserCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    await cdp.send('Extensions.triggerAction', { id, targetId: targetInfos.find(target => target.type === 'tab' && target.url === youtube.url())!.targetId });
    const popupOpened = context.waitForEvent('page');
    await worker.evaluate(id => chrome.tabs.create({ url: `chrome-extension://${id}/popup.html`, active: false }), id);
    const popup = await popupOpened;
    const monitorOpened = context.waitForEvent('page'); await popup.getByRole('button', { name: 'この動画のチャットを取得' }).click();
    const monitor = await monitorOpened;
    await expect(monitor.getByRole('button', { name: '取得を開始', exact: true })).toBeEnabled();
    const frame = youtube.frames().find(frame => frame.url().includes('/live_chat'))!;
    for (index = 0; index < cases.length; index++) {
      const scenario = cases[index];
      expect(await options.evaluate(threshold => chrome.runtime.sendMessage({ type: 'settings.saveFilter', threshold }), scenario.threshold))
        .toEqual({ ok: true, value: { threshold: scenario.threshold } });
      const before = calls;
      await monitor.getByRole('button', { name: 'Jev判定を有効化・再開' }).click();
      await expect(monitor.getByTestId('jev-status')).toContainText('有効');
      await monitor.getByRole('button', { name: '取得を開始', exact: true }).click();
      if (index === 0) {
        await expect.poll(() => typeof release, { timeout: 15000 }).toBe('function');
        expect(await options.evaluate(() => chrome.runtime.sendMessage({ type: 'settings.saveFilter', threshold: 0.9 })))
          .toEqual({ ok: true, value: { threshold: 0.9 } });
        expect(calls).toBe(before + 1); release();
      }
      const row = monitor.locator('#messages li').filter({ hasText: `API fixture ${index}` });
      await expect(row).toContainText(`判定の基準値 ${scenario.threshold}`, { timeout: 15000 });
      await expect(row).toContainText(scenario.malicious ? '悪質' : '該当なし');
      if (scenario.malicious) {
        await expect(monitor.locator('#hidden-authors')).toContainText(authors[index]);
        await expect(frame.locator(`#author-${index}`)).toBeHidden();
      } else {
        await expect(monitor.locator('#hidden-authors')).not.toContainText(authors[index]);
        await expect(frame.locator(`#author-${index}`)).toBeVisible();
      }
      if (index === 0) {
        expect(await monitor.evaluate(() => chrome.runtime.sendMessage({ type: 'jev.evaluate', id: 'post-0' })))
          .toMatchObject({ ok: true, value: { threshold: 0.65, malicious: true } });
        expect(calls).toBe(before + 1);
      }
      await monitor.getByRole('button', { name: '取得を停止', exact: true }).click();
      await expect(frame.locator('#author-0')).toBeHidden();
      expect(calls).toBe(before + 1);
    }
    expect(calls).toBe(cases.length);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
