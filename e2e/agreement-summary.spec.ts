import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

declare const chrome: {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  storage: { local: {
    get(keys: string[]): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
    remove(key: string): Promise<void>;
  } };
};

test('初期読取中は全文表示、保存中の通知は保留、読取応答エラーで再同意を表示', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'moderator-agreement-pending-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.addInitScript(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      const state = { reads: 0, saves: 0, rejectRead: false, release: () => {} };
      Object.assign(globalThis, { agreementPending: state });
      chrome.runtime.sendMessage = async message => {
        const type = (message as { type?: string }).type;
        if (type === 'confirmation.get') {
          state.reads++;
          if (state.rejectRead) throw new Error('fixture response failure');
        }
        if (type === 'confirmation.confirm') state.saves++;
        if ((type === 'confirmation.get' && state.reads === 1) || type === 'confirmation.confirm') {
          await new Promise<void>(resolve => { state.release = resolve; });
        }
        return send(message);
      };
    });
    await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
    const disclosure = page.locator('.sending-disclosure');
    const summary = page.getByText('同意内容を確認', { exact: true });
    const save = page.getByRole('button', { name: '同意を保存', exact: true });
    await expect(disclosure).toBeVisible();
    await expect(summary).toBeHidden();
    await page.getByRole('checkbox').check(); await expect(save).toBeDisabled();
    await page.evaluate(() => (globalThis as unknown as { agreementPending: { release(): void } }).agreementPending.release());
    await expect(page.getByTestId('confirmation-status')).toContainText('未同意');
    await page.getByRole('checkbox').check(); await save.click();
    await expect(save).toBeDisabled(); await expect(disclosure).toBeVisible();
    await worker.evaluate(() => chrome.runtime.sendMessage({ type: 'confirmation.changed' }));
    expect(await page.evaluate(() => (globalThis as unknown as { agreementPending: { reads: number } }).agreementPending.reads)).toBe(1);
    await page.evaluate(() => (globalThis as unknown as { agreementPending: { release(): void } }).agreementPending.release());
    await expect(page.getByTestId('confirmation-status')).toContainText('同意済み');
    await expect(disclosure).toBeHidden();
    await expect.poll(() => page.evaluate(() => (globalThis as unknown as { agreementPending: { reads: number } }).agreementPending.reads)).toBeGreaterThan(1);
    expect(await page.evaluate(() => (globalThis as unknown as { agreementPending: { saves: number } }).agreementPending.saves)).toBe(1);
    await summary.click(); await expect(disclosure).toBeVisible();
    await page.evaluate(() => { (globalThis as unknown as { agreementPending: { rejectRead: boolean } }).agreementPending.rejectRead = true; });
    await worker.evaluate(() => chrome.runtime.sendMessage({ type: 'confirmation.changed' }));
    await expect(page.getByTestId('confirmation-status')).toContainText('保存・取得できませんでした');
    await expect(disclosure).toBeVisible(); await expect(summary).toBeHidden();
    await expect(page.getByRole('checkbox')).toBeVisible(); await expect(save).toBeVisible();
    await expect(save).toBeDisabled();
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

for (const locale of ['ja', 'en', 'fr']) {
  test(`同意説明 ${locale}: 保存・同期・読取・再起動は表示のみ切替`, async () => {
    test.setTimeout(60000);
    const profile = await mkdtemp(join(tmpdir(), 'moderator-agreement-summary-'));
    const extension = resolve('dist');
    const launch = () => chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true, locale,
      env: { ...process.env, LANGUAGE: locale, LANG: `${locale}_${locale.toUpperCase()}.UTF-8` },
      args: [`--lang=${locale}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    let context = await launch();
    let externalRequests = 0;
    const blockAPIs = () => context.route(/https:\/\/(www\.googleapis\.com|api\.typesafe\.ai)\//, route => {
      externalRequests++; return route.abort();
    });
    try {
      await blockAPIs();
      let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      let id = new URL(worker.url()).hostname;
      let page = await context.newPage(); await page.goto(`chrome-extension://${id}/options.html`);
      const agreed = locale === 'ja' ? '同意済み' : 'Agreed';
      const notAgreed = locale === 'ja' ? '未同意' : 'Not agreed';
      const saveName = locale === 'ja' ? '同意を保存' : 'Save agreement';
      const summaryName = locale === 'ja' ? '同意内容を確認' : 'Review agreement details';
      const panel = () => page.locator('section').filter({ has: page.getByTestId('confirmation-status') });
      const details = () => panel().locator('details');
      const disclosure = () => panel().locator('.sending-disclosure');
      const assertLinks = async () => {
        await expect(panel().locator('a')).toHaveCount(4);
        for (const link of await panel().locator('a').all()) await expect(link).toBeVisible();
        await expect(page.getByTestId('confirmation-status')).toBeVisible();
      };
      await expect(page.getByTestId('confirmation-status')).toContainText(notAgreed);
      await expect(details()).toHaveAttribute('open', '');
      await expect(disclosure()).toBeVisible();
      await expect(panel().locator('summary')).toBeHidden();
      await expect(page.getByRole('button', { name: saveName, exact: true })).toBeDisabled();
      await assertLinks();
      const second = await context.newPage(); await second.goto(page.url());
      await expect(second.getByTestId('confirmation-status')).toContainText(notAgreed);
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: saveName, exact: true }).click();
      await expect(page.getByTestId('confirmation-status')).toContainText(agreed);
      await expect(disclosure()).toBeHidden();
      await expect(page.getByRole('checkbox')).toBeHidden();
      await expect(page.getByRole('button', { name: saveName, exact: true })).toBeHidden();
      await expect(second.getByTestId('confirmation-status')).toContainText(agreed);
      await expect(second.locator('.sending-disclosure')).toBeHidden();
      await assertLinks();
      const summary = page.getByText(summaryName, { exact: true });
      await summary.focus(); await page.keyboard.press('Enter');
      await expect(disclosure()).toBeVisible();
      await expect(page.getByRole('checkbox')).toBeHidden();
      await expect(page.getByRole('button', { name: saveName, exact: true })).toBeHidden();
      // Same confirmed state refresh must not collapse an explanation being read.
      await page.evaluate(() => {
        const send = chrome.runtime.sendMessage.bind(chrome.runtime);
        Object.assign(globalThis, { agreementRefreshes: 0 });
        chrome.runtime.sendMessage = async message => {
          const response = await send(message);
          if ((message as { type?: string }).type === 'confirmation.get') {
            (globalThis as unknown as { agreementRefreshes: number }).agreementRefreshes++;
          }
          return response;
        };
      });
      await worker.evaluate(() => chrome.runtime.sendMessage({ type: 'confirmation.changed' }));
      await expect.poll(() => page.evaluate(() => (globalThis as unknown as { agreementRefreshes: number }).agreementRefreshes)).toBeGreaterThan(0);
      await expect(disclosure()).toBeVisible();
      await expect(second.locator('.sending-disclosure')).toBeHidden();
      expect(externalRequests).toBe(0);
      await context.close(); context = await launch(); await blockAPIs();
      worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); id = new URL(worker.url()).hostname;
      page = await context.newPage(); await page.goto(`chrome-extension://${id}/options.html`);
      await expect(page.getByTestId('confirmation-status')).toContainText(agreed);
      await expect(disclosure()).toBeHidden();
      await assertLinks();
      await worker.evaluate(() => chrome.storage.local.set({ 'usage.confirmation': { version: 1 } }));
      await expect(page.getByTestId('confirmation-status')).toContainText(notAgreed);
      await expect(disclosure()).toBeVisible();
      await expect(panel().locator('summary')).toBeHidden();
      await expect(page.getByRole('checkbox')).toBeVisible();
      await page.getByRole('checkbox').check(); await page.getByRole('button', { name: saveName, exact: true }).click();
      await expect(disclosure()).toBeHidden();
      await worker.evaluate(() => chrome.storage.local.remove('usage.confirmation'));
      await expect(disclosure()).toBeVisible();
      await expect(page.getByRole('checkbox')).not.toBeChecked();
      await page.getByRole('checkbox').check(); await page.getByRole('button', { name: saveName, exact: true }).click();
      await expect(disclosure()).toBeHidden();
      await worker.evaluate(() => {
        const get = chrome.storage.local.get.bind(chrome.storage.local);
        chrome.storage.local.get = async keys => {
          if (keys.includes('usage.confirmation')) throw new Error('fixture read failure');
          return get(keys);
        };
      });
      await page.reload();
      await expect(page.getByTestId('confirmation-status')).toContainText(notAgreed);
      await expect(disclosure()).toBeVisible();
      await expect(panel().locator('summary')).toBeHidden();
      await expect(page.getByRole('checkbox')).toBeVisible();
      await expect(page.getByRole('button', { name: saveName, exact: true })).toBeVisible();
      await assertLinks();
      expect(externalRequests).toBe(0);
    } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
  });
}
