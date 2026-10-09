import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
declare const chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
const technical = /raw|confidence|authorChannelId|chrome\.storage\.local|monitor|IPC|fixture|閾値/;
async function withExtension(run: (page: import('@playwright/test').Page, id: string) => Promise<void>) {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-public-copy-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await run(await context.newPage(), new URL(worker.url()).hostname);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
}
test('public copy: 設定とpopupは専門語なし、重要説明を見える段落/listで保持する', async () => {
  await withExtension(async (page, id) => {
    await page.goto(`chrome-extension://${id}/options.html`);
    const notice = page.locator('.settings-notice');
    await expect(notice.locator('li')).toHaveCount(4);
    for (const text of ['他の端末には同期しません', 'アクセスできる人からは保護できません', 'YouTube APIの利用枠', 'Jevの利用料金は利用者負担', 'あなたの画面だけ', '停止しても非表示は続き', 'BANやコメント削除はしません', '接続・認証の確認をせず']) {
      await expect(notice).toContainText(text);
    }
    await expect(notice).toHaveCSS('font-size', '12px');
    await expect(page.locator('body')).not.toContainText(technical);
    await expect(page.locator('body')).not.toContainText('空欄で保存');
    await expect(page.getByTestId('filter-status')).toContainText('現在の設定：中 / 判定の基準値 0.8');
    await page.getByText('詳細設定', { exact: true }).click();
    await expect(page.getByLabel('判定の基準値', { exact: true })).toHaveValue('0.8');
    await expect(page.locator('.filter-details')).toContainText('0では、判定済みのすべてのコメントが悪質');
    await expect(page.locator('.filter-details')).toContainText('1では、スコアが1の項目だけ');
    await page.goto(`chrome-extension://${id}/popup.html`);
    await expect(page.locator('body')).not.toContainText(technical);
    await expect(page.locator('body')).toContainText('あなたの画面だけ');
    await expect(page.locator('body')).toContainText('チャット画面で解除');
    await expect(page.locator('body')).toContainText('BANやコメント削除はしません');
  });
});
test('public copy: Jevの全エラー表示に次操作がありprovider本文は表示しない', async () => {
  await withExtension(async (page, id) => {
    await page.addInitScript(() => {
      chrome.runtime.sendMessage = async message => {
        const { type } = message as { type: string };
        if (type === 'youtube.status') return { ok: true, value: { videoId: 'abcdefghijk', credentialsAvailable: true } };
        if (type === 'hidden.list') return { ok: true, videoId: 'abcdefghijk', ids: [] };
        if (type === 'jev.enable') return { ok: false, error: { code: (globalThis as typeof globalThis & { copyError?: string }).copyError, message: 'synthetic-private-provider-error' } };
        return { ok: true };
      };
    });
    await page.goto(`chrome-extension://${id}/monitor.html`);
    const enable = page.getByRole('button', { name: 'Jev判定を有効化・再開', exact: true });
    await expect(enable).toBeEnabled();
    for (const code of ['confirmationRequired', 'missingKey', 'auth', 'validation', 'rateLimited', 'overloaded', 'network', 'invalidResponse', 'aborted', 'api']) {
      await page.evaluate(code => Object.assign(globalThis, { copyError: code }), code);
      await enable.click();
      await expect(page.getByTestId('jev-status')).toContainText(/確認|同意|保存|再開|更新/);
      await expect(page.getByTestId('jev-status')).toContainText('停止');
      await expect(page.locator('body')).not.toContainText('synthetic-private-provider-error');
      expect((await page.locator('.monitor-note, .monitor-notice').allTextContents()).join(' ')).not.toMatch(technical);
    }
  });
});
