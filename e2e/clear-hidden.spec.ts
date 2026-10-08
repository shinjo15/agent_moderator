import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
declare const chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> }; storage: { local: { get(keys: null): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void> }; session: { get(keys: null): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void> } } };
const video = 'abcdefghijk'; const author = 'UCabcdefghijklmnopqrstuv';
const chat = `<!doctype html><body><yt-live-chat-text-message-renderer id="existing">fixture</yt-live-chat-text-message-renderer><script>document.getElementById('existing').data={authorExternalChannelId:'${author}'};</script></body>`;
test('MV3 全削除: popup設定cancel/赤hover/複数monitor/iframe/popout/全local限定/readback/再起動', async () => {
  test.setTimeout(90000);
  const profile = await mkdtemp(join(tmpdir(), 'issue27-clear-'));
  const extension = resolve('dist');
  const launch = () => chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  let context = await launch();
  try {
    let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: route.request().url().includes('/live_chat') ? chat : '<!doctype html><iframe src="https://www.youtube.com/live_chat?continuation=fixture"></iframe>' }));
    await worker.evaluate(async ({ video, author }) => {
      await chrome.storage.local.set({ [`hiddenAuthors.${video}`]: { ids: [author], displayNames: { [author]: '名前' }, revisions: {} },
        'hiddenAuthors.zyxwvutsrqp': { ids: [], revisions: { [author]: 9 } }, 'hiddenAuthors.00000000000': {},
        'apiKey.youtube': 'synthetic-youtube', 'apiKey.jev': 'synthetic-jev', 'moderation.threshold': 0.65, unrelated: 'keep' });
      await chrome.storage.session.set({ 'youtube.cooldown': { interval: 5000, notBefore: Date.now() + 60000 }, 'jev.notBefore': Date.now() + 60000 });
    }, { video, author });
    const watch = await context.newPage(); await watch.goto(`https://www.youtube.com/watch?v=${video}`);
    const frame = watch.frames().find(f => f.url().includes('/live_chat'))!;
    const popout = await context.newPage(); await popout.goto(`https://www.youtube.com/live_chat?v=${video}&is_popout=1`);
    await expect(frame.locator('#existing')).toBeHidden(); await expect(popout.locator('#existing')).toBeHidden();
    const cdp = await context.newCDPSession(popout);
    const worlds: { id: number; origin: string; auxData?: { type?: string } }[] = [];
    cdp.on('Runtime.executionContextCreated', event => worlds.push(event.context)); await cdp.send('Runtime.enable');
    await expect.poll(() => worlds.some(w => w.origin === `chrome-extension://${id}` && w.auxData?.type === 'isolated')).toBe(true);
    const world = worlds.find(w => w.origin === `chrome-extension://${id}` && w.auxData?.type === 'isolated')!;
    const denied = await cdp.send('Runtime.evaluate', { contextId: world.id, awaitPromise: true, returnByValue: true,
      expression: "chrome.runtime.sendMessage({type:'hidden.clearAll'})" });
    expect(denied.result.value).toEqual({ ok: false });
    const monitors = await Promise.all([context.newPage(), context.newPage()]);
    for (const page of monitors) await page.goto(`chrome-extension://${id}/monitor.html`);
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.getByRole('button', { name: '設定を開く', exact: true }).click();
    await expect(popup).toHaveURL(`chrome-extension://${id}/options.html`);
    await expect(popup.getByRole('heading', { name: '全配信の非表示データを削除', exact: true })).toBeVisible();
    const button = popup.getByRole('button', { name: '全配信の非表示データを削除', exact: true });
    await expect(button).toBeVisible(); await button.hover();
    expect(await button.evaluate(e => getComputedStyle(e).backgroundColor)).toBe('rgb(185, 28, 28)');
    await button.click(); const dialog = popup.getByRole('dialog');
    await expect(dialog).toContainText('全配信'); await expect(dialog).toContainText('APIキー'); await expect(dialog).toContainText('判定の基準値');
    await dialog.getByRole('button', { name: 'キャンセル', exact: true }).click();
    expect(await worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).some(key => key.startsWith('hiddenAuthors.')))).toBe(true);
    const cooldown = await worker.evaluate(() => chrome.storage.session.get(null));
    await button.click(); await dialog.getByRole('button', { name: '削除する', exact: true }).click();
    await expect(popup.getByTestId('hidden-clear-status')).toContainText('削除しました');
    await expect(frame.locator('#existing')).toBeVisible(); await expect(popout.locator('#existing')).toBeVisible();
    for (const page of monitors) await expect(page.getByRole('status')).toContainText('非表示データの削除');
    expect(await worker.evaluate(async () => {
      const data = await chrome.storage.local.get(null);
      return { hidden: Object.keys(data).filter(key => key.startsWith('hiddenAuthors.')), youtube: data['apiKey.youtube'] === 'synthetic-youtube', jev: data['apiKey.jev'] === 'synthetic-jev', threshold: data['moderation.threshold'], unrelated: data.unrelated };
    })).toEqual({ hidden: [], youtube: true, jev: true, threshold: 0.65, unrelated: 'keep' });
    expect(await worker.evaluate(() => chrome.storage.session.get(null))).toEqual({ ...cooldown, 'hidden.collectionPaused': true });
    expect(await popup.evaluate(() => chrome.runtime.sendMessage({ type: 'hidden.clearAll', body: 'synthetic' })) ).toEqual({ ok: false });
    expect(await monitors[0].evaluate(() => chrome.runtime.sendMessage({ type: 'hidden.clearAll' })) ).toEqual({ ok: false });
    await context.close(); context = await launch();
    worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    expect(await worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).some(key => key.startsWith('hiddenAuthors.')))).toBe(false);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('UI: 削除失敗応答では成功を表示せず再試行できる', async ({ page }) => {
  // Execute built options UI against a synthetic runtime, never user storage.
  await page.route('https://fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><main></main>' }));
  await page.goto('https://fixture.test/');
  await page.evaluate(() => {
    (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { id: 'fixture', getURL: (p: string) => p,
      sendMessage: async (m: { type: string }) => m.type === 'storage.init' ? { ok: true, status: { youtube: true, jev: true } } : m.type === 'settings.getFilter' ? { ok: true, value: { threshold: 0.8 } } : { ok: false },
      onMessage: { addListener() {} }, onMessageExternal: { addListener() {} } } };
  });
  await page.addScriptTag({ path: resolve('dist/options.js') });
  const button = page.getByRole('button', { name: '全配信の非表示データを削除', exact: true });
  await button.click(); await page.getByRole('dialog').getByRole('button', { name: '削除する', exact: true }).click();
  await expect(page.getByTestId('hidden-clear-status')).toContainText('削除を確認できませんでした');
  await expect(page.getByTestId('hidden-clear-status')).not.toContainText('削除しました');
  await expect(button).toBeEnabled();
});
