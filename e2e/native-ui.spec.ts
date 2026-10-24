import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { apiResponse } from '../tests/fixtures/jev';
import { confirmUsage } from './fixtures/confirm-usage';

declare const chrome: { tabs: { create(options: { url: string; active: boolean }): Promise<unknown> }; storage: { local: { set(values: Record<string, unknown>): Promise<void> } } };
const video = 'abcdefghijk';
const author = 'UCabcdefghijklmnopqrstuv';
const fixture = `<!doctype html><meta charset="UTF-8"><body>
<video id="player" controls></video><a id="author" href="/channel/${author}">みどり</a>
<button id="chat-toggle" aria-expanded="true">標準チャットを閉じる</button>
<button id="block">標準ブロック操作</button>
<yt-live-chat-text-message-renderer id="existing" style="display: block; color: rgb(12, 34, 56)">変更しないコメント</yt-live-chat-text-message-renderer>
<script>
document.querySelector('#existing').data={authorExternalChannelId:'${author}'};
window.nativeClicks=0;
document.querySelector('#chat-toggle').onclick=()=>window.nativeClicks++;
document.querySelector('#block').onclick=()=>window.nativeClicks++;
window.nativeMutations=[];
document.addEventListener('DOMContentLoaded',()=>{
new MutationObserver(records=>window.nativeMutations.push(...records.map(r=>r.type+':'+r.target.nodeName+':'+r.attributeName)))
.observe(document.body,{attributes:true,childList:true,characterData:true,subtree:true});
});
</script></body>`;

test('YouTube各画面へ注入せずDOM/CSS/標準操作を維持し、実判定・解除でも表示を変えない', async () => {
  test.setTimeout(90000);
  const profile = await mkdtemp(join(tmpdir(), 'moderator-native-ui-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    await worker.evaluate(({ video, author }) => chrome.storage.local.set({
      [`hiddenAuthors.${video}`]: { ids: [author], revisions: {}, displayNames: { [author]: 'みどり' } },
    }), { video, author });
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body:
      route.request().url().includes('/watch?') ? fixture.replace('</body>', `<iframe src="https://www.youtube.com/live_chat?v=${video}"></iframe></body>`) : fixture }));
    await context.route('https://www.googleapis.com/youtube/v3/**', route => route.fulfill({ json:
      new URL(route.request().url()).pathname.endsWith('/videos')
        ? { items: [{ id: video, liveStreamingDetails: { activeLiveChatId: 'fixture-chat' } }] }
        : { nextPageToken: 'next', pollingIntervalMillis: 5000, items: [{ id: 'native-boundary-post',
          snippet: { type: 'textMessageEvent', hasDisplayContent: true, displayMessage: 'APIから取得したコメント' },
          authorDetails: { channelId: author, displayName: 'みどり' } }] },
    }));
    let releaseJev: (() => void) | undefined;
    await context.route('https://api.typesafe.ai/v1/systemone', async route => {
      await new Promise<void>(resolve => { releaseJev = resolve; });
      await route.fulfill({ json: apiResponse({ attack: 0.8 }) });
    });
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    await confirmUsage(options);
    for (const provider of ['YouTube', 'Jev']) {
      await options.getByLabel(`${provider} APIキー`).fill(`synthetic-native-${provider}`);
      await options.getByRole('button', { name: `${provider}キーを保存`, exact: true }).click();
      await expect(options.getByLabel(`${provider} APIキー`)).toHaveValue('');
    }
    for (const path of [`watch?v=${video}`, `live/${video}`, `embed/${video}`, `live_chat?v=${video}`, `live_chat?v=${video}&is_popout=1`, `live_chat_replay?v=${video}`]) {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      const worlds: string[] = []; const scripts: string[] = [];
      cdp.on('Runtime.executionContextCreated', event => worlds.push(event.context.origin));
      cdp.on('Debugger.scriptParsed', event => scripts.push(event.url));
      await cdp.send('Runtime.enable'); await cdp.send('Debugger.enable');
      await page.goto(`https://www.youtube.com/${path}`);
      const snapshots: string[] = [];
      for (const frame of page.frames()) snapshots.push(await frame.evaluate(() => document.body.outerHTML));
      // Bounded negative observation catches delayed extension injection as well.
      await page.waitForTimeout(1200);
      async function expectNativeUnchanged() {
        for (const [index, frame] of page.frames().entries()) {
          expect(await frame.evaluate(() => document.body.outerHTML)).toBe(snapshots[index]);
          await expect(frame.locator('#existing')).toBeVisible();
          expect(await frame.locator('#existing').evaluate(node => ({ display: getComputedStyle(node).display, color: getComputedStyle(node).color })))
            .toEqual({ display: 'block', color: 'rgb(12, 34, 56)' });
          expect(await frame.evaluate(() => (globalThis as typeof globalThis & { nativeClicks: number; nativeMutations: string[] }).nativeMutations)).toEqual([]);
          expect(await frame.evaluate(() => (globalThis as typeof globalThis & { nativeClicks: number }).nativeClicks)).toBe(0);
          expect(await frame.evaluate(() => {
            const value = (globalThis as unknown as { chrome?: { runtime?: { id?: string }; storage?: unknown } }).chrome;
            return Boolean(value?.runtime?.id || value?.storage);
          })).toBe(false);
        }
        expect(worlds).not.toContain(`chrome-extension://${id}`);
        expect(scripts.filter(url => url.startsWith(`chrome-extension://${id}/`))).toEqual([]);
      }
      await expectNativeUnchanged();
      if (path.startsWith('watch?')) {
        // Exercise the real save/remove lifecycle while observing both watch and iframe.
        await page.bringToFront();
        const browserCdp = await context.browser()!.newBrowserCDPSession();
        const { targetInfos } = await browserCdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
        await browserCdp.send('Extensions.triggerAction', { id, targetId: targetInfos.find(target => target.type === 'tab' && target.url === page.url())!.targetId });
        const pp = context.waitForEvent('page');
        await worker.evaluate(id => chrome.tabs.create({ url: `chrome-extension://${id}/popup.html`, active: false }), id);
        const popup = await pp;
        const mp = context.waitForEvent('page');
        await popup.getByRole('button', { name: 'この動画のチャットを取得' }).click();
        const monitor = await mp;
        const unhide = monitor.getByRole('button', { name: `みどり（投稿者ID：${author}）の非表示を解除`, exact: true });
        await monitor.getByRole('button', { name: '非表示一覧', exact: true }).click();
        await unhide.click();
        await expect(monitor.locator('#hidden-authors li')).toHaveCount(0);
        await monitor.keyboard.press('Escape');
        await monitor.getByRole('button', { name: 'Jev判定を有効化・再開' }).click();
        await expect(monitor.getByTestId('jev-status')).toContainText('有効');
        await monitor.getByRole('button', { name: '取得を開始', exact: true }).click();
        await expect.poll(() => typeof releaseJev, { timeout: 15000 }).toBe('function');
        await expectNativeUnchanged();
        releaseJev!();
        await expect(monitor.locator('#hidden-authors li')).toContainText(author);
        await expect(monitor.locator('#messages li')).toHaveCount(0);
        await expect(monitor.locator('#messages')).not.toContainText('APIから取得したコメント');
        await expectNativeUnchanged();
        await monitor.getByRole('button', { name: '取得を停止', exact: true }).click();
        await monitor.getByRole('button', { name: '非表示一覧', exact: true }).click();
        await unhide.click();
        await expect(monitor.locator('#hidden-authors li')).toHaveCount(0);
        await expect(monitor.locator('#messages li')).toHaveCount(1);
        await expect(monitor.locator('#messages')).toContainText('APIから取得したコメント');
        await expectNativeUnchanged();
        await monitor.close(); await popup.close();
        // Remaining URL forms also start with a stored matching author.
        await worker.evaluate(({ video, author }) => chrome.storage.local.set({
          [`hiddenAuthors.${video}`]: { ids: [author], revisions: {} },
        }), { video, author });
      }
      for (const frame of page.frames()) {
        await frame.locator('#chat-toggle').click(); await frame.locator('#block').click();
        expect(await frame.evaluate(() => (globalThis as typeof globalThis & { nativeClicks: number }).nativeClicks)).toBe(2);
      }
      await page.close();
    }
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
