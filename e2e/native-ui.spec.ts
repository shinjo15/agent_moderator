import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

declare const chrome: { storage: { local: { set(values: Record<string, unknown>): Promise<void> } } };
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

test('YouTube watch/live/embed/iframe/popout/replay: 保存済みIDでもDOM/CSS/標準操作へ介入しない', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'moderator-native-ui-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    await worker.evaluate(({ video, author }) => chrome.storage.local.set({
      [`hiddenAuthors.${video}`]: { ids: [author], revisions: {}, displayNames: { [author]: 'みどり' } },
    }), { video, author });
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body:
      route.request().url().includes('/watch?') ? fixture.replace('</body>', `<iframe src="https://www.youtube.com/live_chat?v=${video}"></iframe></body>`) : fixture }));
    for (const path of [`watch?v=${video}`, `live/${video}`, `embed/${video}`, `live_chat?v=${video}`, `live_chat?v=${video}&is_popout=1`, `live_chat_replay?v=${video}`]) {
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      const worlds: string[] = []; const scripts: string[] = [];
      cdp.on('Runtime.executionContextCreated', event => worlds.push(event.context.origin));
      cdp.on('Debugger.scriptParsed', event => scripts.push(event.url));
      await cdp.send('Runtime.enable'); await cdp.send('Debugger.enable');
      await page.goto(`https://www.youtube.com/${path}`);
      const snapshots = [];
      for (const frame of page.frames()) snapshots.push(await frame.evaluate(() => document.body.outerHTML));
      // Bounded negative observation spans both old 500ms MAIN and 1s content timers.
      await page.waitForTimeout(1200);
      for (const [index, frame] of page.frames().entries()) {
        expect(await frame.evaluate(() => document.body.outerHTML)).toBe(snapshots[index]);
        await expect(frame.locator('#existing')).toBeVisible();
        expect(await frame.locator('#existing').evaluate(node => ({ display: getComputedStyle(node).display, color: getComputedStyle(node).color })))
          .toEqual({ display: 'block', color: 'rgb(12, 34, 56)' });
        expect(await frame.evaluate(() => (globalThis as typeof globalThis & { nativeClicks: number; nativeMutations: string[] }).nativeMutations)).toEqual([]);
        expect(await frame.evaluate(() => (globalThis as typeof globalThis & { nativeClicks: number }).nativeClicks)).toBe(0);
        await frame.locator('#chat-toggle').click(); await frame.locator('#block').click();
        expect(await frame.evaluate(() => (globalThis as typeof globalThis & { nativeClicks: number }).nativeClicks)).toBe(2);
      }
      expect(worlds).not.toContain(`chrome-extension://${id}`);
      expect(scripts.filter(url => url.startsWith(`chrome-extension://${id}/`))).toEqual([]);
      await page.close();
    }
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
