import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

test('実際のMV3拡張を読み込み、設定・popup・設定リンクを開ける', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).hostname;
    expect(worker.url()).toBe(`chrome-extension://${extensionId}/background.js`);
    const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`chrome-extension://${extensionId}/${manifest.options_ui.page}`);
    await expect(page.getByRole('heading', { name: 'Agent Moderator 設定' })).toBeVisible();
    await expect(page.getByText('設定機能は今後のIssueで追加します。')).toBeVisible();
    await expect(page.locator('input')).toHaveCount(0);
    await page.goto(`chrome-extension://${extensionId}/${manifest.action.default_popup}`);
    await expect(page.getByRole('heading', { name: 'Agent Moderator', exact: true })).toBeVisible();
    await expect(page.getByText('フィルター機能は未実装です。')).toBeVisible();
    await page.getByRole('link', { name: '設定を開く' }).click();
    await expect(page.getByRole('heading', { name: 'Agent Moderator 設定' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
