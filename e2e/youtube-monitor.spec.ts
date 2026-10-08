import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

declare const chrome: {
  tabs: { create(options: { url: string; active: boolean }): Promise<unknown> };
  runtime: { sendMessage(message: unknown): Promise<unknown> };
};

test('production MV3: activeTabから選択しYouTubeタブ前面でもfixture取得を継続、停止/キー削除', async () => {
  test.setTimeout(90000);
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-production-fixture-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    const tokens: (string | null)[] = [];
    const callTimes: number[] = [];
    let mode: 'success' | 'quota' | 'invalid' = 'success';
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>YouTube視聴タブfixture</title><h1>配信fixture（実配信ではない）</h1>' }));
    await context.route('https://www.googleapis.com/youtube/v3/**', async route => {
      const url = new URL(route.request().url());
      expect(['fixture-not-real-key', 'fixture-replacement']).toContain(url.searchParams.get('key'));
      if (url.pathname.endsWith('/videos')) {
        await route.fulfill({ json: { items: [{ id: 'abcdefghijk', liveStreamingDetails: { activeLiveChatId: 'fixture-chat' } }] } });
      } else {
        tokens.push(url.searchParams.get('pageToken')); callTimes.push(Date.now());
        if (mode === 'quota') {
          await route.fulfill({ status: 403, json: { error: { message: 'private-provider-message https://private.invalid', errors: [{ reason: 'quotaExceeded' }] } } });
          return;
        }
        if (mode === 'invalid') { await route.fulfill({ json: { items: [] } }); return; }
        await route.fulfill({ json: { nextPageToken: `next-${tokens.length}`, pollingIntervalMillis: 5000, items: [
          { id: 'duplicate', snippet: { type: 'textMessageEvent', hasDisplayContent: true, displayMessage: 'fixture本文' }, authorDetails: { channelId: 'fixture-author' } },
          { id: `message-${tokens.length}`, snippet: { type: 'textMessageEvent', hasDisplayContent: true, displayMessage: '<img src=x onerror=alert(1)>' }, authorDetails: { channelId: 'fixture-author' } },
        ] } });
      }
    });
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    await expect(options.getByText(/「取得を開始」でYouTubeへ通信します/)).toBeVisible();
    expect(await options.evaluate(() => chrome.runtime.sendMessage({ type: 'youtube.resolve', videoId: 'abcdefghijk', requestId: 'forbidden' })))
      .toMatchObject({ ok: false, error: { code: 'forbidden' } });
    await options.getByLabel('YouTube APIキー').fill('fixture-not-real-key');
    await options.getByRole('button', { name: 'YouTubeキーを保存' }).click();
    await expect(options.getByTestId('youtube-status')).toHaveText('設定済み');
    const youtube = await context.newPage();
    await youtube.goto('https://www.youtube.com/watch?v=abcdefghijk');
    await youtube.bringToFront();
    const browserCdp = await context.browser()!.newBrowserCDPSession();
    const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    const tabTarget = targetInfos.find(target => target.type === 'tab' && target.url === youtube.url());
    expect(tabTarget).toBeDefined();
    await browserCdp.send('Extensions.triggerAction', { id, targetId: tabTarget!.targetId });
    // Chromeのaction popup targetはPlaywright Pageではないため、activeTabを実actionで
    // grantした後、同じproduction popupを非activeタブでexerciseする（権限は追加しない）。
    const popupPromise = context.waitForEvent('page');
    await worker.evaluate(extensionId => chrome.tabs.create({ url: `chrome-extension://${extensionId}/popup.html`, active: false }), id);
    const popup = await popupPromise;
    await expect(popup.getByRole('button', { name: 'この動画のチャットを取得' })).toBeEnabled();
    const monitorPromise = context.waitForEvent('page');
    await popup.getByRole('button', { name: 'この動画のチャットを取得' }).click();
    const monitor = await monitorPromise;
    await expect(monitor).toHaveURL(`chrome-extension://${id}/monitor.html`);
    await expect(monitor.getByRole('button', { name: '取得を開始' })).toBeEnabled();
    await monitor.getByRole('button', { name: '取得を開始' }).click();
    await expect(monitor.locator('#messages li')).toHaveCount(2, { timeout: 12000 });
    await youtube.bringToFront();
    await expect(monitor.locator('#messages li')).toHaveCount(3, { timeout: 15000 });
    expect(tokens).toEqual([null, 'next-1']);
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(5000);
    await expect(monitor.locator('#messages img')).toHaveCount(0);
    await monitor.getByRole('button', { name: '取得を停止' }).click();
    await expect(monitor.getByRole('status')).toHaveText('取得を停止しました。');
    const count = tokens.length;
    await youtube.waitForTimeout(5500);
    expect(tokens).toHaveLength(count);
    await monitor.getByRole('button', { name: '取得を開始' }).click();
    await expect.poll(() => tokens.length, { timeout: 10000 }).toBe(count + 1);
    await options.getByRole('button', { name: 'YouTubeキーを削除' }).click();
    await expect(monitor.getByRole('button', { name: '取得を開始' })).toBeDisabled();
    const deletedCount = tokens.length;
    await youtube.waitForTimeout(5500);
    expect(tokens).toHaveLength(deletedCount);
    // 差替え/再設定は自動再開せず、明示開始だけが新キーで取得する。
    await options.getByLabel('YouTube APIキー').fill('fixture-replacement');
    await options.getByRole('button', { name: 'YouTubeキーを保存' }).click();
    await expect(monitor.getByRole('button', { name: '取得を開始' })).toBeEnabled();
    expect(tokens).toHaveLength(deletedCount);
    mode = 'quota';
    await monitor.getByRole('button', { name: '取得を開始' }).click();
    await expect(monitor.getByRole('status')).toHaveText('YouTube APIの利用上限に達しました。利用枠を確認し、回復してから取得を再開してください。', { timeout: 12000 });
    await expect(monitor.locator('body')).not.toContainText('private-provider-message');
    const quotaCount = tokens.length;
    await youtube.waitForTimeout(5500);
    expect(tokens).toHaveLength(quotaCount);
    mode = 'invalid';
    await monitor.getByRole('button', { name: '取得を開始' }).click();
    await expect(monitor.getByRole('status')).toHaveText('YouTubeからのデータを確認できず、取得を停止しました。時間をおいて取得を再開してください。', { timeout: 10000 });
    await youtube.goto('https://www.youtube.com/watch?v=zyxwvutsrqp');
    await expect(monitor.getByRole('button', { name: '取得を開始' })).toBeDisabled();
    await expect(monitor.getByText(/視聴タブが変更または閉じられました/)).toBeVisible();
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
