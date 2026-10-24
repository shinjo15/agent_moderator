import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { confirmUsage } from './fixtures/confirm-usage';
import { apiResponse } from '../tests/fixtures/jev';

type ChromeWindow = { id?: number; type?: string; left?: number; top?: number; width?: number; height?: number; state?: string };
declare const chrome: {
  windows: { getCurrent(): Promise<ChromeWindow>; get(id: number): Promise<ChromeWindow>; getAll(): Promise<ChromeWindow[]> };
  tabs: { create(options: { url: string; active: boolean }): Promise<unknown> };
  runtime: { sendMessage(message: unknown): Promise<unknown> };
};

test('production MV3: 実activeTab grantとonUpdatedで親ライブだけ追従し停止とorigin失効を守る', async () => {
  test.setTimeout(120000);
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-follow-parent-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    const resolved: string[] = [];
    const pages: { chat: string; token: string | null; time: number }[] = [];
    let releaseOld: (() => void) | undefined;
    let jevCalls = 0;
    await context.route('https://api.typesafe.ai/v1/systemone', async route => {
      jevCalls++;
      await route.fulfill({ status: 401, json: apiResponse() });
    });
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>親タブfixture</title>' }));
    await context.route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>対象外fixture</title>' }));
    await context.route('https://www.googleapis.com/youtube/v3/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/videos')) {
        const video = url.searchParams.get('id')!; resolved.push(video);
        await route.fulfill({ json: { items: [{ id: video, snippet: { channelId: video === 'abcdefghijk' ? 'UC0000000000000000000000' : 'UC1111111111111111111111' },
          liveStreamingDetails: { activeLiveChatId: `chat-${video}` } }] } });
      } else {
        const chat = url.searchParams.get('liveChatId')!;
        pages.push({ chat, token: url.searchParams.get('pageToken'), time: Date.now() });
        if (chat === 'chat-abcdefghijk' && pages.filter(page => page.chat === chat).length === 2) {
          await new Promise<void>(resolve => { releaseOld = resolve; });
        }
        await route.fulfill({ json: { nextPageToken: `next-${pages.length}`, pollingIntervalMillis: 5000, items: [{ id: `post-${pages.length}`,
          snippet: { type: 'textMessageEvent', hasDisplayContent: true, displayMessage: chat, publishedAt: new Date().toISOString() }, authorDetails: { channelId: 'UCabcdefghijklmnopqrstuv' } }] } }).catch(() => {});
      }
    });
    const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
    await confirmUsage(options);
    await options.getByLabel('YouTube APIキー').fill('synthetic-follow');
    await options.getByRole('button', { name: 'YouTubeキーを保存', exact: true }).click();
    await options.getByLabel('Jev APIキー').fill('synthetic-follow-jev');
    await options.getByRole('button', { name: 'Jevキーを保存', exact: true }).click();
    const youtube = await context.newPage(); await youtube.goto('https://www.youtube.com/watch?v=abcdefghijk'); await youtube.bringToFront();
    const cdp = await context.browser()!.newBrowserCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    const tab = targetInfos.find(target => target.type === 'tab' && target.url === youtube.url());
    await cdp.send('Extensions.triggerAction', { id, targetId: tab!.targetId });
    const popupPromise = context.waitForEvent('page');
    await worker.evaluate(extensionId => chrome.tabs.create({ url: `chrome-extension://${extensionId}/popup.html`, active: false }), id);
    const popup = await popupPromise;
    await expect(popup.getByRole('button', { name: 'この動画のチャットを取得' })).toBeEnabled();
    const monitorPromise = context.waitForEvent('page'); await popup.getByRole('button', { name: 'この動画のチャットを取得' }).click();
    const monitor = await monitorPromise;
    await monitor.getByRole('button', { name: '取得を開始', exact: true }).click();
    await expect(monitor.locator('#messages')).toContainText('chat-abcdefghijk', { timeout: 15000 });
    await monitor.getByRole('button', { name: 'Jev判定を有効化・再開' }).click();
    await expect(monitor.getByTestId('jev-status')).toContainText('有効');
    const other = await context.newPage(); await other.goto('https://www.youtube.com/watch?v=otherlive01');
    const otherWindow = await worker.evaluate(async () => {
      const created = await (chrome.windows as unknown as { create(options: { url: string; type: string }): Promise<ChromeWindow> })
        .create({ url: 'https://www.youtube.com/watch?v=otherlive02', type: 'normal' });
      return created.id;
    });
    expect(otherWindow).toBeDefined();
    await expect(monitor.locator('.viewer-header')).toContainText('abcdefghijk');
    await expect.poll(() => typeof releaseOld, { timeout: 12000 }).toBe('function');
    await youtube.goto('https://www.youtube.com/watch?v=zyxwvutsrqp');
    releaseOld!();
    await expect(monitor.locator('.viewer-header')).toContainText('zyxwvutsrqp');
    await expect(monitor.getByRole('button', { name: '取得を停止', exact: true })).toBeEnabled();
    await expect(monitor.getByTestId('jev-status')).toContainText('有効', { timeout: 35000 });
    await expect(monitor.locator('#messages')).toContainText('chat-zyxwvutsrqp', { timeout: 35000 });
    await expect(monitor.getByTestId('jev-status')).toContainText('認証に失敗');
    expect(jevCalls).toBe(1);
    await expect(monitor.locator('#messages')).not.toContainText('chat-abcdefghijk');
    expect(resolved).toEqual(['abcdefghijk', 'zyxwvutsrqp']);
    expect(pages.find(page => page.chat === 'chat-zyxwvutsrqp')!.token).toBeNull();
    for (let index = 1; index < pages.length; index++) expect(pages[index].time - pages[index - 1].time).toBeGreaterThanOrEqual(4900);
    // Same-video query/hash and a full reload keep the selection, not a new resolve.
    await youtube.evaluate(() => history.pushState(null, '', '/watch?v=zyxwvutsrqp&t=10#chat'));
    await youtube.reload();
    await expect(monitor.getByRole('button', { name: '取得を停止', exact: true })).toBeEnabled();
    expect(resolved).toEqual(['abcdefghijk', 'zyxwvutsrqp']);
    await monitor.getByRole('button', { name: '取得を停止', exact: true }).click();
    await youtube.evaluate(() => history.pushState(null, '', '/live/finalvideo1'));
    await expect(monitor.locator('.viewer-header')).toContainText('finalvideo1');
    await expect(monitor.getByRole('button', { name: '取得を開始', exact: true })).toBeEnabled();
    await monitor.waitForTimeout(5500); expect(resolved).toEqual(['abcdefghijk', 'zyxwvutsrqp']);
    await monitor.getByRole('button', { name: '取得を開始', exact: true }).click();
    await expect(monitor.locator('#messages')).toContainText('chat-finalvideo1', { timeout: 15000 });
    await youtube.goto('https://example.com/outside');
    await expect(monitor.getByRole('button', { name: '取得を停止', exact: true })).toBeDisabled();
    await expect(monitor.getByText(/視聴タブが変更または閉じられました/)).toBeVisible();
    const count = pages.length;
    await youtube.goto('https://www.youtube.com/watch?v=abcdefghijk');
    await monitor.waitForTimeout(5500); expect(pages).toHaveLength(count);
    await expect(monitor.getByRole('button', { name: '取得を開始', exact: true })).toBeDisabled();
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

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
    let videoCalls = 0;
    const callTimes: number[] = [];
    let mode: 'success' | 'quota' | 'invalid' = 'success';
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>YouTube視聴タブfixture</title><h1>配信fixture（実配信ではない）</h1>' }));
    await context.route('https://www.googleapis.com/youtube/v3/**', async route => {
      const url = new URL(route.request().url());
      expect(['fixture-not-real-key', 'fixture-replacement']).toContain(url.searchParams.get('key'));
      if (url.pathname.endsWith('/videos')) {
        videoCalls++;
        await route.fulfill({ json: { items: [{ id: 'abcdefghijk', snippet: { channelId: 'UC0000000000000000000000' }, liveStreamingDetails: { activeLiveChatId: 'fixture-chat' } }] } });
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
    const pageErrors: string[] = [];
    context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
    options.on('pageerror', error => pageErrors.push(error.message));
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
    const watchBefore = await popup.evaluate(() => chrome.windows.getCurrent());
    const windowsBefore = await worker.evaluate(async () => (await chrome.windows.getAll()).map(window => window.id).sort());
    const monitorPromise = context.waitForEvent('page');
    await popup.getByRole('button', { name: 'この動画のチャットを取得' }).click();
    const monitor = await monitorPromise;
    await expect(monitor).toHaveURL(`chrome-extension://${id}/monitor.html`);
    const viewerWindow = await monitor.evaluate(() => chrome.windows.getCurrent());
    expect(viewerWindow.id).not.toBe(watchBefore.id);
    expect(viewerWindow.type).toBe('normal');
    expect(viewerWindow.id).toBeDefined();
    expect(await worker.evaluate(async () => (await chrome.windows.getAll()).map(window => window.id).sort())).toEqual([...windowsBefore, viewerWindow.id].sort());
    const watchAfter = await worker.evaluate(windowId => chrome.windows.get(windowId!), watchBefore.id);
    for (const key of ['left', 'top', 'width', 'height', 'state'] as const) expect(watchAfter[key]).toEqual(watchBefore[key]);
    expect(await youtube.title()).toBe('YouTube視聴タブfixture');
    await expect(monitor.getByRole('button', { name: '取得を開始' })).toBeEnabled();
    expect(await monitor.evaluate(() => chrome.runtime.sendMessage({ type: 'jev.enable' })))
      .toMatchObject({ ok: false, error: { code: 'confirmationRequired' } });
    await monitor.getByRole('button', { name: '取得を開始' }).click();
    await expect(monitor.getByRole('status')).toContainText('設定で利用規約案');
    expect(videoCalls).toBe(0); expect(tokens).toHaveLength(0);
    await confirmUsage(options);
    await monitor.getByRole('button', { name: '取得を開始' }).click();
    await expect(monitor.locator('#messages li')).toHaveCount(2, { timeout: 12000 });
    await youtube.bringToFront();
    await expect(monitor.locator('#messages li')).toHaveCount(3, { timeout: 15000 });
    expect(tokens).toEqual([null, 'next-1']);
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(5000);
    await expect(monitor.locator('#messages img')).toHaveCount(0);
    await expect(monitor.locator('#messages')).toContainText('<img src=x onerror=alert(1)>');
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
    const invalidCount = tokens.length;
    await youtube.waitForTimeout(5500);
    expect(tokens).toHaveLength(invalidCount);
    await youtube.goto('https://www.youtube.com/watch?v=zyxwvutsrqp');
    await expect(monitor.getByRole('button', { name: '取得を開始' })).toBeEnabled();
    await expect(monitor.locator('.viewer-header')).toContainText('zyxwvutsrqp');
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
