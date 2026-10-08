import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { apiResponse } from '../tests/fixtures/jev';
declare const chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> }; tabs: { create(o: { url: string; active: boolean }): Promise<unknown> }; storage: { local: { get(keys: string[]): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void> } } };
const video = 'abcdefghijk';
const a = 'UCabcdefghijklmnopqrstuv'; const b = 'UCzyxwvutsrqponmlkjihgfe';
const c = `UC${'c'.repeat(22)}`; const legacy = `UC${'d'.repeat(22)}`;
const longName = 'さくら <img src=x onerror=alert(1)> ' + 'はるかぜ'.repeat(200);
const key = `hiddenAuthors.${video}`;
const label = (name: string, id: string) => `${name}（投稿者ID：${id}）の非表示を解除`;
declare const nameFixture: { fault(value: string): void; legacy(): void };
async function openMonitor(context: BrowserContext, extensionId: string): Promise<{ monitor: Page; watch: Page }> {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const watch = await context.newPage(); await watch.goto(`https://www.youtube.com/watch?v=${video}`); await watch.bringToFront();
  const cdp = await context.browser()!.newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
  await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: targetInfos.find(t => t.type === 'tab' && t.url === watch.url())!.targetId });
  const pp = context.waitForEvent('page');
  await worker.evaluate(id => chrome.tabs.create({ url: `chrome-extension://${id}/popup.html`, active: false }), extensionId);
  const popup = await pp;
  const mp = context.waitForEvent('page'); await popup.getByRole('button', { name: 'この動画のチャットを取得' }).click();
  const monitor = await mp; await expect(monitor.getByRole('button', { name: '取得を開始', exact: true })).toBeEnabled();
  return { monitor, watch };
}
async function routeWatch(context: BrowserContext) {
  await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body:
    route.request().url().includes('/live_chat') ? `<!doctype html><body><script>
      for(const [id,author] of ${JSON.stringify([['a', a], ['b', b], ['c', c], ['legacy', legacy]])}) {
        const e=document.createElement('yt-live-chat-text-message-renderer');e.id=id;e.textContent='みどり';e.data={authorExternalChannelId:author};document.body.append(e);
      }</script></body>` : '<!doctype html><iframe src="https://www.youtube.com/live_chat?continuation=fixture"></iframe>' }));
}
test('MV3 names: 公式応答fixture→判定→名前永続→browser再起動、同名別ID/legacy解除/XSS/長名/取得済み改名', async () => {
  test.setTimeout(90000);
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-author-names-'));
  const extension = resolve('dist'); let context: BrowserContext | undefined;
  const launch = () => chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    context = await launch();
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); const id = new URL(worker.url()).hostname;
    await worker.evaluate(({ key, legacy }) => chrome.storage.local.set({ [key]: { ids: [legacy], revisions: { [legacy]: 7 } } }), { key, legacy });
    await routeWatch(context);
    const requests: string[] = []; let pages = 0; let renamed = false; let jevCalls = 0;
    await context.route('https://www.googleapis.com/youtube/v3/**', route => {
      const url = new URL(route.request().url()); requests.push(url.pathname);
      expect(url.searchParams.has('fields')).toBe(false);
      if (url.pathname.endsWith('/videos')) return route.fulfill({ json: { items: [{ id: video, liveStreamingDetails: { activeLiveChatId: 'synthetic-chat' } }] } });
      expect(url.pathname).toBe('/youtube/v3/liveChat/messages'); expect(url.searchParams.get('part')).toBe('id,snippet,authorDetails');
      const posts = renamed ? [[a, 'みどりの庭', '落ち着いたコメント']] : [[a, 'みどり', '宣伝を繰り返す'], [b, 'みどり', '今日も楽しみです'], [c, longName, '攻撃的なコメント']];
      return route.fulfill({ json: { nextPageToken: `next-${++pages}`, pollingIntervalMillis: 5000, items: posts.map(([channelId, displayName, text], n) => ({
        id: `post-${pages}-${n}`, snippet: { type: 'textMessageEvent', hasDisplayContent: true, displayMessage: text, publishedAt: new Date().toISOString() },
        authorDetails: { channelId, displayName },
      })) } });
    });
    await context.route('https://api.typesafe.ai/v1/systemone', route => {
      jevCalls++; const state = route.request().postDataJSON().state;
      expect(JSON.stringify(state)).not.toContain('みどり'); expect(JSON.stringify(state)).not.toContain('authorDisplayName');
      return route.fulfill({ json: apiResponse({ attack: state.target.text === '今日も楽しみです' ? 0.1 : 1 }) });
    });
    const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
    for (const provider of ['YouTube', 'Jev']) {
      await options.getByLabel(`${provider} APIキー`).fill(`synthetic-${provider}`);
      await options.getByRole('button', { name: `${provider}キーを保存`, exact: true }).click();
      await expect(options.getByLabel(`${provider} APIキー`)).toHaveValue('');
    }
    const { monitor, watch } = await openMonitor(context, id);
    const frame = watch.frames().find(f => f.url().includes('/live_chat'))!;
    await expect(monitor.locator('#hidden-authors .author-name')).toHaveText('名前不明');
    await monitor.getByRole('button', { name: 'Jev判定を有効化・再開' }).click();
    await expect(monitor.getByTestId('jev-status')).toContainText('有効');
    await monitor.getByRole('button', { name: '取得を開始', exact: true }).click();
    await expect(monitor.locator('#messages .author-name')).toHaveText(['みどり', 'みどり', longName], { timeout: 15000 });
    await expect(monitor.locator('#hidden-authors .author-name')).toHaveText(['名前不明', 'みどり', longName], { timeout: 15000 });
    await expect(frame.locator('#a')).toBeHidden(); await expect(frame.locator('#b')).toBeVisible(); await expect(frame.locator('#c')).toBeHidden();
    await monitor.getByRole('button', { name: '取得を停止', exact: true }).click();
    expect(jevCalls).toBe(3); expect(requests).toEqual(['/youtube/v3/videos', '/youtube/v3/liveChat/messages']);
    await expect(monitor.locator('#messages img, #messages script, #hidden-authors img, #hidden-authors script')).toHaveCount(0);
    await monitor.setViewportSize({ width: 480, height: 720 });
    expect(await monitor.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await monitor.getByRole('button', { name: label('名前不明', legacy), exact: true }).click();
    await expect(frame.locator('#legacy')).toBeVisible(); await expect(monitor.locator('#hidden-authors li')).toHaveCount(2);
    renamed = true;
    await monitor.getByRole('button', { name: '取得を開始', exact: true }).click();
    await expect(monitor.locator('#hidden-authors .author-name')).toHaveText(['みどりの庭', longName], { timeout: 15000 });
    await monitor.getByRole('button', { name: '取得を停止', exact: true }).click();
    expect(jevCalls).toBe(3); expect(requests.filter(p => p.endsWith('/videos'))).toHaveLength(1);
    const persisted = await worker.evaluate(async key => (await chrome.storage.local.get([key]))[key], key);
    expect(persisted).toEqual({ ids: [a, c], revisions: { [legacy]: 8 }, displayNames: { [a]: 'みどりの庭', [c]: longName } });
    await context.close(); context = await launch();
    const restarted = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    expect(await restarted.evaluate(async key => (await chrome.storage.local.get([key]))[key], key)).toEqual(persisted);
    await routeWatch(context);
    let restartCalls = 0; await context.route('https://www.googleapis.com/**', route => { restartCalls++; return route.abort(); });
    const reopened = await openMonitor(context, new URL(restarted.url()).hostname);
    await expect(reopened.monitor.locator('#hidden-authors .author-name')).toHaveText(['みどりの庭', longName]);
    await expect(reopened.monitor.locator('#messages li')).toHaveCount(0);
    const restartedFrame = reopened.watch.frames().find(f => f.url().includes('/live_chat'))!;
    await expect(restartedFrame.locator('#a')).toBeHidden(); await expect(restartedFrame.locator('#b')).toBeVisible();
    await reopened.monitor.getByRole('button', { name: label('みどりの庭', a), exact: true }).click();
    await expect(restartedFrame.locator('#a')).toBeVisible(); await expect(restartedFrame.locator('#c')).toBeHidden();
    await expect(reopened.monitor.locator('#hidden-authors .author-name')).toHaveText(longName);
    expect(restartCalls).toBe(0);
  } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});

test('names UI fixture: 同名別IDの解除aria-label、不正name/ID/video IPC拒否、旧ID-only一覧の正直な表示', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-name-ui-')); const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const page = await context.newPage(); await page.clock.install();
    await page.addInitScript(({ a, b, legacy, video }) => {
      let ids = [a, b, legacy]; let mode = '';
      Object.assign(globalThis, { nameFixture: { fault(value: string) { mode = value; }, legacy() { mode = 'legacy'; } } });
      chrome.runtime.sendMessage = async (request: unknown) => {
        const m = request as { type: string; authorChannelId: string };
        if (m.type === 'youtube.status') return { ok: true, value: { videoId: video, credentialsAvailable: true } };
        if (m.type === 'hidden.remove') { ids = ids.filter(id => id !== m.authorChannelId); return { ok: true }; }
        if (m.type === 'hidden.list') {
          if (mode === 'legacy') return { ok: true, videoId: video, ids };
          const authors = ids.map(authorChannelId => ({ authorChannelId, ...(authorChannelId === legacy ? {} : { displayName: 'みどり' }) }));
          if (mode === 'name') return { ok: true, videoId: video, ids, authors: [{ ...authors[0], displayName: 123 }] };
          if (mode === 'id') return { ok: true, videoId: video, ids: ['invalid-channel', ...ids], authors };
          return { ok: true, videoId: mode === 'video' ? 'zyxwvutsrqp' : video, ids, authors };
        }
        return { ok: true };
      };
    }, { a, b, legacy, video });
    await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/monitor.html`);
    await expect(page.locator('#hidden-authors .author-name')).toHaveText(['みどり', 'みどり', '名前不明']);
    await expect(page.getByRole('button', { name: label('みどり', a), exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: label('みどり', b), exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: label('みどり', a), exact: true }).click();
    await expect(page.locator('#hidden-authors .author-name')).toHaveText(['みどり', '名前不明']);
    await page.getByRole('button', { name: label('名前不明', legacy), exact: true }).click();
    await expect(page.locator('#hidden-authors .author-name')).toHaveText(['みどり']);
    for (const fault of ['name', 'id', 'video']) {
      await page.evaluate(fault => nameFixture.fault(fault), fault); await page.clock.runFor(1100);
      await expect(page.locator('.hidden-author-panel > p[aria-live]')).toContainText('確認できません');
      await expect(page.locator('#hidden-authors .author-name')).toHaveText('みどり');
    }
    await page.evaluate(() => nameFixture.legacy()); await page.clock.runFor(1100);
    await expect(page.locator('#hidden-authors .author-name')).toHaveText('名前不明');
    await page.getByRole('button', { name: label('名前不明', b), exact: true }).click();
    await expect(page.locator('#hidden-authors li')).toHaveCount(0);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
