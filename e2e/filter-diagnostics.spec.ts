import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
declare const chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> }; storage: { local: { set(values: Record<string, unknown>): Promise<void> } } };
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
      await expect(save).toBeEnabled();
      expect(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'settings.getFilter' })))
        .toEqual({ ok: true, value: { threshold: 0.8 } });
      await worker.evaluate(() => (globalThis as typeof globalThis & { restoreFilterStorage(): void }).restoreFilterStorage());
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
      ['initialGet', 'transport', '', ['settings.getFilter']],
      ['save', 'invalidShape', ' shape:000000', ['settings.getFilter', 'settings.saveFilter']],
      ['save', 'valueMismatch', '', ['settings.getFilter', 'settings.saveFilter']],
      ['readback', 'valueMismatch', '', ['settings.getFilter', 'settings.saveFilter', 'settings.getFilter']],
    ] as const) {
      const page = await context.newPage();
      await page.addInitScript(({ stage, reason }) => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        let gets = 0; let failing = true;
        const requests: string[] = [];
        Object.assign(globalThis, { filterStageProbe: { requests, recover: () => { failing = false; } } });
        chrome.runtime.sendMessage = async message => {
          const type = (message as { type?: string }).type;
          if (type !== 'settings.getFilter' && type !== 'settings.saveFilter') return original(message);
          requests.push(type);
          const phase = type === 'settings.saveFilter' ? 'save' : ++gets === 1 ? 'initialGet' : 'readback';
          if (failing && phase === stage) {
            if (reason === 'transport') throw new Error('synthetic-private-stage-error');
            return reason === 'invalidShape' ? false : { ok: true, value: { threshold: 0.9 } };
          }
          return original(message);
        };
      }, { stage, reason });
      await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
      const save = page.getByRole('button', { name: 'フィルター設定を保存', exact: true });
      await expect(save).toBeEnabled();
      if (stage !== 'initialGet') {
        await page.getByLabel('フィルターの強さ', { exact: true }).selectOption('medium');
        await save.click();
      }
      await expect(page.getByTestId('filter-status')).toContainText(`確認コード: filter-${stage}-${reason}${shape}`);
      await expect(page.getByTestId('filter-status')).not.toContainText('保存しました');
      await expect(page.locator('body')).not.toContainText('synthetic-private-stage-error');
      await expect(save).toBeEnabled();
      expect(await page.evaluate(() => (globalThis as typeof globalThis & { filterStageProbe: { requests: string[] } }).filterStageProbe.requests)).toEqual([...expectedTypes]);
      await page.evaluate(() => (globalThis as typeof globalThis & { filterStageProbe: { recover(): void } }).filterStageProbe.recover());
      await save.click();
      await expect(page.getByTestId('filter-status')).toHaveText('保存しました：中 / 判定の基準値 0.8');
      await page.close();
    }
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
