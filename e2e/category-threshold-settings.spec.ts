import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
declare const chrome: { storage: { local: { get(keys: string[]): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void> } } };
async function checkCategoryGeometry(page: import('@playwright/test').Page) {
  const rows = page.locator('.category-row'); await expect(rows).toHaveCount(7);
  for (const row of await rows.all()) {
    const label = row.locator('label'); const input = row.locator('input');
    await expect(label).toBeVisible(); await expect(input).toBeVisible();
    await input.focus(); await expect(input).toBeFocused();
    const geometry = await row.evaluate(element => {
      const label = element.querySelector('label')!.getBoundingClientRect();
      const input = element.querySelector('input')!.getBoundingClientRect();
      const row = element.getBoundingClientRect();
      return { labelLeft: label.left, labelRight: label.right, labelTop: label.top, labelBottom: label.bottom,
        inputLeft: input.left, inputRight: input.right, inputTop: input.top, inputBottom: input.bottom,
        rowLeft: row.left, rowRight: row.right, viewportWidth: innerWidth, viewportHeight: innerHeight };
    });
    expect(geometry.labelLeft).toBeGreaterThanOrEqual(geometry.rowLeft);
    expect(geometry.labelRight).toBeLessThanOrEqual(geometry.inputLeft);
    expect(geometry.inputRight).toBeLessThanOrEqual(Math.min(geometry.rowRight, geometry.viewportWidth));
    expect(geometry.inputTop).toBeGreaterThanOrEqual(0);
    expect(geometry.inputBottom).toBeLessThanOrEqual(geometry.viewportHeight);
    expect(geometry.inputBottom).toBeGreaterThan(geometry.inputTop);
    expect(geometry.labelBottom).toBeGreaterThan(geometry.labelTop);
  }
}

test('破損設定は確認なしに変更せず、明示復旧で中へ戻す', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-category-corrupt-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await worker.evaluate(() => chrome.storage.local.set({ 'moderation.threshold': { active: 'custom', custom: { mode: 'individual', bulk: 0.8, individual: { attack: 0.4 } } } }));
    const page = await context.newPage(); await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
    await expect(page.getByTestId('filter-status')).toContainText('破損');
    const reset = page.getByRole('button', { name: 'フィルター設定を初期値に戻す' });
    page.once('dialog', dialog => dialog.dismiss()); await reset.click();
    await expect(page.getByTestId('filter-status')).toContainText('破損');
    page.once('dialog', dialog => dialog.accept()); await reset.click();
    await expect(page.getByTestId('filter-status')).toContainText('現在の設定：中 / 判定の基準値 0.8');
    await expect(page.getByRole('button', { name: 'フィルター設定を保存' })).toBeEnabled();
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('2画面の競合は未保存を保持し、破棄を明示するまで上書きしない', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-category-conflict-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const url = `chrome-extension://${new URL(worker.url()).hostname}/options.html`;
    const a = await context.newPage(); await a.goto(url);
    await a.getByLabel('フィルターの強さ', { exact: true }).selectOption('custom');
    await a.getByLabel('個別（7項目）').check();
    await a.getByRole('button', { name: 'フィルター設定を保存' }).click();
    await expect(a.getByTestId('filter-status')).toContainText('保存しました');
    const b = await context.newPage(); await b.goto(url);
    const hate = '属性に基づく差別・憎悪'; const attack = '人への攻撃、侮辱、人格否定';
    await b.getByLabel(hate, { exact: true }).fill('0.9');
    await b.getByRole('button', { name: 'フィルター設定を保存' }).click();
    await expect(b.getByTestId('filter-status')).toContainText('保存しました');
    await a.getByLabel(attack, { exact: true }).fill('0.4');
    await a.getByRole('button', { name: 'フィルター設定を保存' }).click();
    await expect(a.getByTestId('filter-status')).toContainText('別の画面で設定が変更');
    a.once('dialog', dialog => dialog.dismiss()); await a.getByRole('button', { name: '設定を再確認' }).click();
    await expect(a.getByLabel(attack, { exact: true })).toHaveValue('0.4');
    await expect(a.getByRole('button', { name: 'フィルター設定を保存' })).toBeDisabled();
    a.once('dialog', dialog => dialog.accept()); await a.getByRole('button', { name: '設定を再確認' }).click();
    await expect(a.getByLabel(hate, { exact: true })).toHaveValue('0.9');
    await expect(a.getByLabel(attack, { exact: true })).toHaveValue('0.8');
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('英語・狭幅で個別の7項目を編集し無効な値を拒否する', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-category-en-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, locale: 'en',
    env: { ...process.env, LANGUAGE: 'en', LANG: 'en_US.UTF-8' }, viewport: { width: 320, height: 700 },
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const page = await context.newPage(); await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
    const select = page.getByLabel('Filter strength', { exact: true }); await expect(select).toBeEnabled();
    await select.selectOption('custom'); await page.getByLabel('Individual (seven categories)').check();
    const fields = page.locator('.category-row input'); await expect(fields).toHaveCount(7);
    await checkCategoryGeometry(page);
    await fields.nth(0).fill('0'); await fields.nth(1).fill('1'); await fields.nth(2).fill('1.1');
    await page.getByRole('button', { name: 'Save filter settings' }).click();
    await expect(page.getByTestId('filter-status')).toContainText('Not saved');
    await fields.nth(2).fill('0.5'); await page.getByRole('button', { name: 'Save filter settings' }).click();
    await expect(page.getByTestId('filter-status')).toContainText('Saved: Custom (individual / seven categories)');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('保存readback失敗は適用済みの可能性を示し、再確認で実状態を表示する', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-category-error-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const page = await context.newPage(); await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
    const select = page.getByLabel('フィルターの強さ', { exact: true }); await expect(select).toBeEnabled();
    await worker.evaluate(() => {
      const originalSet = chrome.storage.local.set.bind(chrome.storage.local);
      const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
      let fail = false;
      chrome.storage.local.set = async values => { await originalSet(values); if ('moderation.threshold' in values) fail = true; };
      chrome.storage.local.get = async keys => { if (fail && keys.includes('moderation.threshold')) { fail = false; throw new Error('synthetic'); } return originalGet(keys); };
    });
    await select.selectOption('high'); await page.getByRole('button', { name: 'フィルター設定を保存' }).click();
    await expect(page.getByTestId('filter-status')).toContainText('変わっている可能性');
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '設定を再確認' }).click();
    await expect(page.getByTestId('filter-status')).toContainText('現在の設定：高 / 判定の基準値 0.65');
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('customの一括・個別は別々に保持し、個別保存はプリセット・再起動後も復帰する', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-category-'));
  const launch = () => chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`], viewport: { width: 320, height: 700 } });
  let context = await launch();
  try {
    let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    let page = await context.newPage(); await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
    const strength = page.getByLabel('フィルターの強さ', { exact: true });
    await expect(strength).toBeEnabled();
    await strength.selectOption('high'); await strength.selectOption('custom');
    const bulk = page.getByLabel('7項目共通の判定の基準値');
    await expect(bulk).toHaveValue('0.65'); await bulk.fill('0.31');
    await page.getByLabel('個別（7項目）').check();
    await checkCategoryGeometry(page);
    const attack = page.getByLabel('人への攻撃、侮辱、人格否定', { exact: true });
    await expect(attack).toHaveValue('0.65'); await attack.fill('0.42');
    await page.getByLabel('一括（7項目共通）').check(); await expect(bulk).toHaveValue('0.31');
    await page.getByLabel('個別（7項目）').check(); await expect(attack).toHaveValue('0.42');
    await expect(page.locator('.filter-card')).toContainText('選択中の方式だけが保存されます');
    await expect(page.locator('.filter-card')).toContainText('一括の未保存入力があります');
    await strength.selectOption('high');
    await expect(page.getByText('一括の未保存入力があります。', { exact: true })).toBeVisible();
    await expect(page.getByText('個別の未保存入力があります。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'フィルター設定を保存' }).click();
    await expect(page.getByTestId('filter-status')).toContainText('保存しました');
    await expect(page.getByText('一括の未保存入力があります。', { exact: true })).toBeVisible();
    await strength.selectOption('custom');
    await page.getByRole('button', { name: 'フィルター設定を保存' }).click();
    await expect(page.getByTestId('filter-status')).toContainText('保存しました');
    await expect(page.locator('.filter-card')).toContainText('一括の未保存入力があります');
    await strength.selectOption('low'); await page.getByRole('button', { name: 'フィルター設定を保存' }).click();
    await expect(page.getByTestId('filter-status')).toContainText('保存しました');
    await context.close(); context = await launch();
    worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    page = await context.newPage(); await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
    const select = page.getByLabel('フィルターの強さ', { exact: true }); await expect(select).toHaveValue('low');
    await select.selectOption('custom');
    await expect(page.getByLabel('個別（7項目）')).toBeChecked();
    await expect(page.getByLabel('人への攻撃、侮辱、人格否定', { exact: true })).toHaveValue('0.42');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
