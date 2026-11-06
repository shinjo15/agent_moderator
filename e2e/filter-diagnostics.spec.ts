import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
declare const chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> }; storage: { local: { set(values: Record<string, unknown>): Promise<void> } } };
test('非アクティブな個別値が保存応答と読戻しで同じ不正値に変わっても成功表示しない', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-inactive-'));
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.addInitScript(() => {
      const send = chrome.runtime.sendMessage.bind(chrome.runtime);
      let afterSave = false;
      chrome.runtime.sendMessage = async message => {
        const response = await send(message) as { ok?: boolean; value?: { config?: { custom?: { individual?: Record<string, number> } } } };
        const type = (message as { type?: string }).type;
        if (type === 'settings.saveFilterConfig') afterSave = true;
        if (afterSave && response.value?.config?.custom?.individual) response.value.config.custom.individual.attack = 0.123;
        return response;
      };
    });
    await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
    await page.getByLabel('フィルターの強さ', { exact: true }).selectOption('custom');
    await page.getByLabel('7項目共通の判定の基準値').fill('0.5');
    await page.getByRole('button', { name: 'フィルター設定を保存' }).click();
    await expect(page.getByTestId('filter-status')).toContainText('filter-save-valueMismatch');
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
// Response classification uses the production parser in tests/filter-diagnostics.test.ts.
// Keep real MV3 messaging/storage failures and recovery at the extension boundary here.
for (const fault of ['write', 'readback'] as const) {
  test(`設定保存の${fault}失敗を秘密なしで表示し、再操作で保存・読取確認できる`, async () => {
    const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-filter-diagnostics-'));
    const extension = resolve('dist');
    const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const page = await context.newPage();
      const logs: string[] = [];
      page.on('console', message => logs.push(message.text()));
      page.on('pageerror', error => logs.push(error.message));
      worker.on('console', message => logs.push(message.text()));
      await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
      await expect(page.getByTestId('filter-status')).toContainText('現在の設定');
      await worker.evaluate(fault => {
        const original = chrome.storage.local.set.bind(chrome.storage.local);
        Object.assign(globalThis, { restoreFilterStorage: () => { chrome.storage.local.set = original; } });
        chrome.storage.local.set = async values => {
          if ('moderation.threshold' in values) {
            if (fault === 'write') throw new Error('synthetic-private-key-storage-profile-error');
            return; // Acknowledge without persisting: production readback must reject it.
          }
          return original(values);
        };
      }, fault);
      await page.getByLabel('フィルターの強さ', { exact: true }).selectOption('high');
      const save = page.getByRole('button', { name: 'フィルター設定を保存', exact: true });
      await save.click();
      await expect(page.getByTestId('filter-status')).toContainText(`確認コード: filter-save-${fault}`);
      await expect(page.getByTestId('filter-status')).not.toContainText('保存しました');
      await expect(page.locator('body')).not.toContainText('synthetic-private-key-storage-profile-error');
      await expect(save).toBeDisabled();
      expect(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'settings.getFilter' })))
        .toEqual({ ok: true, value: { threshold: 0.8 } });
      await worker.evaluate(() => (globalThis as typeof globalThis & { restoreFilterStorage(): void }).restoreFilterStorage());
      await page.getByRole('button', { name: '設定を再確認' }).click();
      await expect(save).toBeEnabled();
      await save.click();
      await expect(page.getByTestId('filter-status')).toHaveText('保存しました：高 / 判定の基準値 0.65');
      expect(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'settings.getFilter' })))
        .toEqual({ ok: true, value: { threshold: 0.65 } });
      expect(logs.join('\n')).not.toContain('synthetic-private-key-storage-profile-error');
    } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
  });
}

test('UIの初期読取・保存応答・再読取の失敗は到達段階で止まり、再操作できる', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-filter-stages-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    // Each UI control-flow boundary once, not response classification × stages.
    for (const [stage, reason, shape, expectedTypes] of [
      ['initialGet', 'transport', '', ['settings.getFilterConfig']],
      ['save', 'invalidShape', '', ['settings.getFilterConfig', 'settings.saveFilterConfig']],
      ['save', 'valueMismatch', '', ['settings.getFilterConfig', 'settings.saveFilterConfig']],
      ['readback', 'valueMismatch', '', ['settings.getFilterConfig', 'settings.saveFilterConfig', 'settings.getFilterConfig']],
    ] as const) {
      const page = await context.newPage();
      await page.addInitScript(({ stage, reason }) => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        let gets = 0; let failing = true;
        const requests: string[] = [];
        Object.assign(globalThis, { filterStageProbe: { requests, recover: () => { failing = false; } } });
        chrome.runtime.sendMessage = async message => {
          const type = (message as { type?: string }).type;
          if (type !== 'settings.getFilterConfig' && type !== 'settings.saveFilterConfig') return original(message);
          requests.push(type);
          const phase = type === 'settings.saveFilterConfig' ? 'save' : ++gets === 1 ? 'initialGet' : 'readback';
          if (failing && phase === stage) {
            if (reason === 'transport') throw new Error('synthetic-private-stage-error');
            return reason === 'invalidShape' ? false : { ok: true, value: { config: { active: 'low', custom: null } } };
          }
          return original(message);
        };
      }, { stage, reason });
      await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
      const save = page.getByRole('button', { name: 'フィルター設定を保存', exact: true });
      if (stage !== 'initialGet') {
        await expect(save).toBeEnabled();
        await page.getByLabel('フィルターの強さ', { exact: true }).selectOption('medium');
        await save.click();
      }
      await expect(page.getByTestId('filter-status')).toContainText(`確認コード: filter-${stage}-${reason}${shape}`);
      await expect(page.getByTestId('filter-status')).not.toContainText('保存しました');
      await expect(page.locator('body')).not.toContainText('synthetic-private-stage-error');
      await expect(save).toBeDisabled();
      expect(await page.evaluate(() => (globalThis as typeof globalThis & { filterStageProbe: { requests: string[] } }).filterStageProbe.requests)).toEqual([...expectedTypes]);
      await page.evaluate(() => (globalThis as typeof globalThis & { filterStageProbe: { recover(): void } }).filterStageProbe.recover());
      await page.getByRole('button', { name: '設定を再確認' }).click();
      await expect(save).toBeEnabled();
      await page.getByLabel('フィルターの強さ', { exact: true }).selectOption('medium');
      await save.click();
      await expect(page.getByTestId('filter-status')).toHaveText('保存しました：中 / 判定の基準値 0.8');
      await page.close();
    }
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
