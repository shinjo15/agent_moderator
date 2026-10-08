import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
declare const chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
const cases = [
  ['initialGet', 'initialize'], ['initialGet', 'read'], ['initialGet', 'invalidStored'], ['initialGet', 'authorization'],
  ['save', 'authorization'], ['save', 'write'], ['save', 'readback'], ['save', 'transport'], ['save', 'noResponse'],
  ['save', 'unknownReason'], ['save', 'malformedResponse'], ['save', 'inconsistentResponse'],
  ['save', 'legacyDenied'], ['save', 'responseBoolean'], ['save', 'thresholdString'],
  ['readback', 'read'], ['readback', 'invalidStored'], ['readback', 'transport'], ['readback', 'noResponse'], ['readback', 'inconsistentResponse'],
] as const;
for (const [stage, fault] of cases) {
  test(`filter diagnostics: ${stage}/${fault}は固定codeだけを表示`, async () => {
    const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-filter-diagnostics-'));
    const extension = resolve('dist');
    const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const page = await context.newPage();
      await page.addInitScript(({ stage, fault }) => {
        const original = chrome.runtime.sendMessage.bind(chrome.runtime);
        let gets = 0;
        chrome.runtime.sendMessage = async message => {
          const type = (message as { type?: string }).type;
          if (type !== 'settings.getFilter' && type !== 'settings.saveFilter') return original(message);
          const phase = type === 'settings.saveFilter' ? 'save' : ++gets === 1 ? 'initialGet' : 'readback';
          if (phase !== stage) return { ok: true, value: { threshold: 0.8 } };
          const marker = 'synthetic-private-key-storage-profile-error';
          if (fault === 'transport') throw new Error(marker);
          if (fault === 'noResponse') return undefined;
          if (fault === 'responseBoolean') return false;
          if (fault === 'legacyDenied') return { ok: false, error: 'この要求は許可されていません。', private: marker };
          if (fault === 'thresholdString') return { ok: true, value: { threshold: '0.8' }, private: marker };
          if (fault === 'inconsistentResponse') return { ok: true, value: { threshold: 0.9 } };
          if (fault === 'malformedResponse') return { ok: true, value: { threshold: marker } };
          return { ok: false, code: fault === 'unknownReason' ? marker : fault, error: marker };
        };
      }, { stage, fault });
      await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
      if (stage !== 'initialGet') {
        await expect(page.getByTestId('filter-status')).toContainText('現在の設定');
        await page.getByRole('button', { name: 'フィルター設定を保存', exact: true }).click();
      }
      const reasons: Record<string, string> = { unknownReason: 'unknownFailureCode', malformedResponse: 'invalidShape', inconsistentResponse: 'valueMismatch', legacyDenied: 'responseDeniedLegacy', responseBoolean: 'invalidShape', thresholdString: 'invalidShape' };
      const reason = reasons[fault] ?? fault;
      await expect(page.getByTestId('filter-status')).toContainText(`確認コード: filter-${stage}-${reason}`);
      if (fault === 'malformedResponse' || fault === 'thresholdString') await expect(page.getByTestId('filter-status')).toContainText('shape:110100');
      if (fault === 'responseBoolean') await expect(page.getByTestId('filter-status')).toContainText('shape:000000');
      await expect(page.getByTestId('filter-status')).not.toContainText('保存しました');
      await expect(page.locator('body')).not.toContainText('synthetic-private-key-storage-profile-error');
      await expect(page.getByRole('button', { name: 'フィルター設定を保存', exact: true })).toBeEnabled();
    } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
  });
}
