import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { apiResponse } from '../tests/fixtures/jev';
import { confirmUsage } from './fixtures/confirm-usage';
import { categories } from '../src/jev/policy';
declare const chrome: { tabs: { create(options: { url: string; active: boolean }): Promise<unknown> }; runtime: { sendMessage(message: unknown): Promise<unknown> } };
const video = 'abcdefghijk';
const cases = [
  { threshold: 0.65, score: 0.7, malicious: true },
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
      return route.fulfill({ json: url.pathname.endsWith('/videos') ? { items: [{ id: video, snippet: { channelId: 'UC0000000000000000000000' }, liveStreamingDetails: { activeLiveChatId: 'fixture-chat' } }] }
        : { nextPageToken: `next-${index}`, pollingIntervalMillis: 5000, items: [{ id: `post-${index}`, snippet: { type: 'textMessageEvent', hasDisplayContent: true,
          displayMessage: `API fixture ${index}`, publishedAt: new Date().toISOString() }, authorDetails: { channelId: authors[index] } }] } });
    });
    let release: (() => void) | undefined;
    await context.route('https://api.typesafe.ai/v1/systemone', async route => {
      const current = index; calls++;
      expect(JSON.stringify(route.request().postDataJSON())).not.toContain('threshold');
      expect(Object.keys(route.request().postDataJSON().questions)).toHaveLength(7);
      if (current <= 1) await new Promise<void>(resolve => { release = resolve; });
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
      const individual = Object.fromEntries(categories.map(key => [key, key === 'attack' ? 0.65 : 0.9]));
      if (index === 0) {
        const config = { active: 'custom', custom: { mode: 'individual', bulk: 0.8, individual } };
        expect(await options.evaluate(async config => {
          const response = await chrome.runtime.sendMessage({ type: 'settings.getFilterConfig' }) as { value: { config: unknown } };
          return chrome.runtime.sendMessage({ type: 'settings.saveFilterConfig', config, expected: response.value.config });
        }, config))
          .toEqual({ ok: true, value: { config } });
      } else {
        expect(await options.evaluate(async threshold => {
          const response = await chrome.runtime.sendMessage({ type: 'settings.getFilterConfig' }) as { value: { config: { active: string; custom: { mode: string; bulk: number; individual: Record<string, number> } | null } } };
          const expected = response.value.config;
          const active = threshold === 0.65 ? 'high' : threshold === 0.8 ? 'medium' : threshold === 0.9 ? 'low' : 'custom';
          const config = { active, custom: active === 'custom' ? { ...expected.custom!, mode: 'bulk', bulk: threshold } : expected.custom };
          return chrome.runtime.sendMessage({ type: 'settings.saveFilterConfig', config, expected });
        }, scenario.threshold)).toMatchObject({ ok: true });
      }
      const before = calls;
      await monitor.getByRole('button', { name: 'Jev判定を有効化・再開' }).click();
      await expect(monitor.getByTestId('jev-status')).toContainText('有効');
      await monitor.getByRole('button', { name: '取得を開始', exact: true }).click();
      if (index <= 1) {
        await expect.poll(() => typeof release, { timeout: 15000 }).toBe('function');
        expect(await options.evaluate(async () => {
          const response = await chrome.runtime.sendMessage({ type: 'settings.getFilterConfig' }) as { value: { config: { custom: unknown } } };
          return chrome.runtime.sendMessage({ type: 'settings.saveFilterConfig', expected: response.value.config,
            config: { active: 'low', custom: response.value.config.custom } });
        })).toMatchObject({ ok: true });
        expect(calls).toBe(before + 1); release!(); release = undefined;
      }
      const row = monitor.locator('#messages li').filter({ hasText: `API fixture ${index}` });
      await expect.poll(() => monitor.evaluate(id => chrome.runtime.sendMessage({ type: 'jev.evaluate', id, thresholdFormat: 2 }), `post-${index}`), { timeout: 15000 })
        .toMatchObject({ ok: true, value: { threshold: index === 0 ? individual : scenario.threshold, malicious: scenario.malicious } });
      if (scenario.malicious) {
        await expect(monitor.locator('#hidden-authors')).toContainText(authors[index]);
        await expect(row).toHaveCount(0);
        await expect(frame.locator(`#author-${index}`)).toBeVisible();
      } else {
        await expect(row).toContainText(`判定の基準値 ${scenario.threshold}`);
        await expect(row).toContainText('該当なし');
        await expect(monitor.locator('#hidden-authors')).not.toContainText(authors[index]);
        await expect(frame.locator(`#author-${index}`)).toBeVisible();
      }
      if (index === 0) {
        expect(await monitor.evaluate(() => chrome.runtime.sendMessage({ type: 'jev.evaluate', id: 'post-0', thresholdFormat: 2 })))
          .toMatchObject({ ok: true, value: { threshold: individual, malicious: true, reasons: ['attack'] } });
        expect(calls).toBe(before + 1);
        await monitor.getByRole('button', { name: '非表示一覧', exact: true }).click();
        await monitor.locator('#hidden-authors button').click();
        await expect(row).toContainText('人への攻撃、侮辱、人格否定');
        await expect(row).toContainText('項目別基準値');
        await expect(row).toContainText('スコア 0.7 / 判定の基準値 0.65');
        await expect(row).not.toContainText('[object Object]');
        await monitor.keyboard.press('Escape');
      }
      if (index === 1) {
        expect(await monitor.evaluate(() => chrome.runtime.sendMessage({ type: 'jev.evaluate', id: 'post-1', thresholdFormat: 2 })))
          .toMatchObject({ ok: true, value: { threshold: 0.65, malicious: true, reasons: ['attack'] } });
        expect(calls).toBe(before + 1);
      }
      await monitor.getByRole('button', { name: '取得を停止', exact: true }).click();
      await expect(frame.locator('#author-0')).toBeVisible();
      expect(calls).toBe(before + 1);
    }
    expect(calls).toBe(cases.length);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
