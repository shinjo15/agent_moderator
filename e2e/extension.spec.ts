import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

declare const chrome: {
  runtime: { sendMessage(message: unknown): Promise<unknown>; reload(): void };
  storage: { local: {
    get(keys: string[] | null): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
    remove(keys: string[]): Promise<void>;
  } };
};

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
    await expect(page.getByText('配信別に投稿者を画面内で非表示にします。監視停止後も非表示は維持され、monitorから解除できます。YouTube上でのBAN・コメント削除は行いません。', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Jev APIキー')).toHaveAttribute('type', 'password');
    await expect(page.getByLabel('YouTube APIキー')).toHaveAttribute('type', 'password');
    await expect(page.getByTestId('youtube-status')).toHaveText('未設定：設定が必要です。');
    await page.getByLabel('Jev APIキー').fill('synthetic-jev');
    await page.getByLabel('YouTube APIキー').fill('synthetic-youtube');
    await page.getByRole('button', { name: 'YouTubeキーを保存' }).click();
    await expect(page.getByTestId('youtube-status')).toHaveText('設定済み');
    await expect(page.getByLabel('YouTube APIキー')).toHaveValue('');
    await expect(page.getByLabel('Jev APIキー')).toHaveValue('synthetic-jev');
    await page.getByRole('button', { name: 'Jevキーを保存', exact: true }).click();
    await expect(page.getByTestId('jev-status')).toHaveText('設定済み');
    await page.getByLabel('Jev APIキー').fill('synthetic-jev-replacement');
    await page.getByRole('button', { name: 'Jevキーを保存', exact: true }).click();
    await expect(page.getByLabel('Jev APIキー')).toHaveValue('');
    await page.getByRole('button', { name: 'Jevキーを保存', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('設定を確認しました。');
    expect(await worker.evaluate(async () => (await chrome.storage.local.get(['apiKey.jev']))['apiKey.jev'] === 'synthetic-jev-replacement')).toBe(true);
    await page.getByRole('button', { name: 'YouTubeキーを保存' }).click();
    await expect(page.getByRole('status')).toHaveText('設定を確認しました。');
    expect(await worker.evaluate(async () => (await chrome.storage.local.get(['apiKey.youtube']))['apiKey.youtube'] === 'synthetic-youtube')).toBe(true);
    await page.getByLabel('YouTube APIキー').fill('synthetic-replacement');
    await page.getByRole('button', { name: 'YouTubeキーを保存' }).click();
    await expect(page.getByLabel('YouTube APIキー')).toHaveValue('');
    expect(await worker.evaluate(async () => (await chrome.storage.local.get(['apiKey.youtube']))['apiKey.youtube'] === 'synthetic-replacement')).toBe(true);
    await page.reload();
    await expect(page.getByTestId('youtube-status')).toHaveText('設定済み');
    await expect(page.getByTestId('jev-status')).toHaveText('設定済み');
    await expect(page.getByLabel('YouTube APIキー')).toHaveValue('');
    expect(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'storage.init' }))).toEqual({ ok: true, status: { jev: true, youtube: true } });
    expect(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'credentials.get', provider: 'youtube' }))).toEqual({ ok: false, error: 'この要求は許可されていません。' });
    await page.getByRole('button', { name: 'YouTubeキーを削除' }).click();
    await expect(page.getByTestId('youtube-status')).toHaveText('未設定：設定が必要です。');
    await expect(page.getByTestId('jev-status')).toHaveText('設定済み');
    expect(await worker.evaluate(async () => !('apiKey.youtube' in await chrome.storage.local.get(null)))).toBe(true);
    await page.getByRole('button', { name: 'Jevキーを削除', exact: true }).click();
    await expect(page.getByTestId('jev-status')).toHaveText('未設定：設定が必要です。');
    await page.reload();
    await expect(page.getByTestId('youtube-status')).toHaveText('未設定：設定が必要です。');
    await expect(page.getByTestId('jev-status')).toHaveText('未設定：設定が必要です。');
    await page.goto(`chrome-extension://${extensionId}/${manifest.action.default_popup}`);
    await expect(page.getByRole('heading', { name: 'Agent Moderator', exact: true })).toBeVisible();
    await expect(page.getByText('配信別に投稿者を画面内で非表示にします。監視停止後も非表示は維持され、monitorから解除できます。YouTube上でのBAN・コメント削除は行いません。')).toBeVisible();
    await page.getByRole('link', { name: '設定を開く' }).click();
    await expect(page.getByRole('heading', { name: 'Agent Moderator 設定' })).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
