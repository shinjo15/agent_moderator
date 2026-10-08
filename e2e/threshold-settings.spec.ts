import { test, expect, chromium, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
declare const chrome: { runtime: { sendMessage(message: unknown, externalMessage?: unknown): Promise<unknown> }; storage: { local: {
  get(keys: string[]): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void>;
} } };
async function launch(profile: string) {
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
  return { context, worker, page };
}
async function withSettings(run: (page: Page, worker: Worker) => Promise<void>) {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-threshold-'));
  const { context, page, worker } = await launch(profile);
  try { await run(page, worker); } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
}
test('filter settings: content/externalの有効payload書込も拒否しpublic設定以外を返さない', async () => {
  await withSettings(async options => {
    await options.getByLabel('フィルターの強さ', { exact: true }).selectOption('low'); await save(options, 0.9);
    const context = options.context(); const id = new URL(options.url()).hostname;
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body>fixture</body>' }));
    const content = await context.newPage(); const cdp = await context.newCDPSession(content);
    const worlds: { id: number; origin: string; auxData?: { type?: string } }[] = [];
    cdp.on('Runtime.executionContextCreated', event => worlds.push(event.context)); await cdp.send('Runtime.enable');
    await content.goto('https://www.youtube.com/live_chat?v=abcdefghijk&is_popout=1');
    await expect.poll(() => worlds.some(world => world.origin === `chrome-extension://${id}` && world.auxData?.type === 'isolated')).toBe(true);
    const world = worlds.find(world => world.origin === `chrome-extension://${id}` && world.auxData?.type === 'isolated')!;
    const response = await cdp.send('Runtime.evaluate', { contextId: world.id, awaitPromise: true, returnByValue: true,
      expression: `(async()=>({read:await chrome.runtime.sendMessage({type:'settings.getFilter'}),write:await chrome.runtime.sendMessage({type:'settings.saveFilter',threshold:0.65})}))()` });
    expect(response.result.value).toEqual({ read: { ok: false, error: 'この要求は許可されていません。', code: 'authorization' }, write: { ok: false, error: 'この要求は許可されていません。', code: 'authorization' } });
    const external = await content.evaluate(async id => {
      try { return (await chrome.runtime.sendMessage(id, { type: 'settings.saveFilter', threshold: 0.65 }) as { ok?: boolean })?.ok !== true; }
      catch { return true; }
    }, id);
    expect(external).toBe(true);
    expect(await options.evaluate(() => chrome.runtime.sendMessage({ type: 'settings.getFilter' }))).toEqual({ ok: true, value: { threshold: 0.9 } });
    expect(await options.evaluate(() => chrome.runtime.sendMessage({ type: 'storage.init' }))).toEqual({ ok: true, status: { jev: false, youtube: false } });
  });
});
async function save(page: Page, threshold: number) {
  await page.getByRole('button', { name: 'フィルター設定を保存', exact: true }).click();
  await expect(page.getByTestId('filter-status')).toContainText(`保存しました：`);
  await expect(page.getByTestId('filter-status')).toContainText(`判定の基準値 ${threshold}`);
  expect(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'settings.getFilter' }))).toEqual({ ok: true, value: { threshold } });
}

test('filter settings: preset3/custom0,1/任意値・無効値・キー下書き独立・保存readback', async () => {
  await withSettings(async page => {
    const strength = page.getByLabel('フィルターの強さ', { exact: true });
    await expect(strength).toHaveValue('medium');
    await expect(page.getByTestId('filter-status')).toContainText('現在の設定：中 / 判定の基準値 0.8');
    await page.getByLabel('Jev APIキー').fill('synthetic-unsent-jev');
    await page.getByLabel('YouTube APIキー').fill('synthetic-unsent-youtube');
    for (const [preset, threshold] of [['high', 0.65], ['low', 0.9], ['medium', 0.8]] as const) {
      await strength.selectOption(preset); await save(page, threshold);
    }
    await page.getByText('詳細設定', { exact: true }).click();
    const custom = page.getByLabel('判定の基準値', { exact: true });
    for (const threshold of [0, 1, 0.731]) {
      await custom.fill(String(threshold)); await expect(strength).toHaveValue('custom'); await save(page, threshold);
    }
    for (const invalid of ['', '-0.1', '1.1']) {
      await custom.fill(invalid);
      await page.getByRole('button', { name: 'フィルター設定を保存', exact: true }).click();
      await expect(page.getByTestId('filter-status')).toContainText('0以上1以下の数値');
      expect(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'settings.getFilter' }))).toEqual({ ok: true, value: { threshold: 0.731 } });
    }
    for (const invalid of ['NaN', 'Infinity']) {
      await custom.evaluate((input, value) => { (input as HTMLInputElement).value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }, invalid);
      await page.getByRole('button', { name: 'フィルター設定を保存', exact: true }).click();
      await expect(page.getByTestId('filter-status')).toContainText('0以上1以下の数値');
    }
    await strength.selectOption('high'); await save(page, 0.65);
    await page.getByText('詳細設定', { exact: true }).click();
    await expect(custom).toHaveValue('0.65');
    await expect(page.getByLabel('Jev APIキー')).toHaveValue('synthetic-unsent-jev');
    await expect(page.getByLabel('YouTube APIキー')).toHaveValue('synthetic-unsent-youtube');
    await expect(page.getByRole('button', { name: 'Jevキーを保存', exact: true })).toBeEnabled();
  });
});

test('filter settings: customはリロード・browser/worker再起動後もlocal永続', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-threshold-restart-'));
  let launched = await launch(profile);
  try {
    await launched.page.getByLabel('フィルターの強さ', { exact: true }).selectOption('custom');
    await launched.page.getByLabel('判定の基準値', { exact: true }).fill('0.731');
    await save(launched.page, 0.731);
    await launched.page.reload();
    await expect(launched.page.getByTestId('filter-status')).toContainText('現在の設定：カスタム / 判定の基準値 0.731');
    await expect(launched.page.getByLabel('フィルターの強さ', { exact: true })).toHaveValue('custom');
    await launched.context.close(); launched = await launch(profile);
    await expect(launched.page.getByTestId('filter-status')).toContainText('現在の設定：カスタム / 判定の基準値 0.731');
    await expect(launched.page.getByLabel('判定の基準値', { exact: true })).toHaveValue('0.731');
    expect(await launched.page.evaluate(() => chrome.runtime.sendMessage({ type: 'settings.getFilter' }))).toEqual({ ok: true, value: { threshold: 0.731 } });
  } finally { await launched.context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('filter settings: 書込失敗とreadback不一致を成功表示せず未送信キーを触らない', async () => {
  await withSettings(async (page, worker) => {
    await expect(page.getByTestId('filter-status')).toContainText('判定の基準値 0.8');
    await page.getByLabel('Jev APIキー').fill('synthetic-unsent');
    for (const fail of [true, false]) {
      await worker.evaluate(fail => {
        const original = chrome.storage.local.set.bind(chrome.storage.local);
        chrome.storage.local.set = async values => {
          if ('moderation.threshold' in values) { if (fail) throw new Error('synthetic-private-setting-error'); return; }
          return original(values);
        };
      }, fail);
      await page.getByLabel('フィルターの強さ', { exact: true }).selectOption('high');
      await page.getByRole('button', { name: 'フィルター設定を保存', exact: true }).click();
      await expect(page.getByTestId('filter-status')).toContainText('処理に失敗');
      await expect(page.getByTestId('filter-status')).not.toContainText('保存しました');
      expect(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'settings.getFilter' }))).toEqual({ ok: true, value: { threshold: 0.8 } });
    }
    await expect(page.getByLabel('Jev APIキー')).toHaveValue('synthetic-unsent');
    await expect(page.getByRole('button', { name: 'Jevキーを保存', exact: true })).toBeEnabled();
    await expect(page.locator('body')).not.toContainText('synthetic-private-setting-error');
  });
});

test('filter settings: 保存中でもキー操作のbusy/clearと独立し未送信キーを保持する', async () => {
  await withSettings(async (page, worker) => {
    await expect(page.getByTestId('filter-status')).toContainText('判定の基準値 0.8');
    await page.getByLabel('Jev APIキー').fill('synthetic-unsent-jev');
    await worker.evaluate(() => {
      const original = chrome.storage.local.set.bind(chrome.storage.local);
      chrome.storage.local.set = async values => {
        if ('moderation.threshold' in values) await new Promise<void>(resolve => Object.assign(globalThis, { releaseFilterSave: resolve }));
        return original(values);
      };
    });
    await page.getByLabel('フィルターの強さ', { exact: true }).selectOption('high');
    const saveFilter = page.getByRole('button', { name: 'フィルター設定を保存', exact: true });
    await saveFilter.click();
    await expect.poll(() => worker.evaluate(() => 'releaseFilterSave' in globalThis)).toBe(true);
    await expect(saveFilter).toBeDisabled();
    await expect(page.getByRole('button', { name: 'YouTubeキーを保存', exact: true })).toBeEnabled();
    await page.getByLabel('YouTube APIキー').fill('synthetic-intentionally-sent');
    await page.getByRole('button', { name: 'YouTubeキーを保存', exact: true }).click();
    await expect(page.getByLabel('YouTube APIキー')).toHaveValue('');
    await expect(page.getByLabel('Jev APIキー')).toHaveValue('synthetic-unsent-jev');
    await expect(saveFilter).toBeDisabled();
    await worker.evaluate(() => (globalThis as typeof globalThis & { releaseFilterSave(): void }).releaseFilterSave());
    await expect(page.getByTestId('filter-status')).toContainText('保存しました：高 / 判定の基準値 0.65');
    expect(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'settings.getFilter' }))).toEqual({ ok: true, value: { threshold: 0.65 } });
    await expect(page.getByLabel('Jev APIキー')).toHaveValue('synthetic-unsent-jev');
  });
});
