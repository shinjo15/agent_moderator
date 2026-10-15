import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
declare const chrome: {
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  storage: { local: { get(keys: string[]): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void> } };
};

test('MV3利用条件: 掲載案リンク・明示確認・複数設定画面・local再起動・旧版再確認（headless fixture）', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-confirmation-'));
  const extension = resolve('dist');
  const launch = () => chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  let context = await launch();
  try {
    let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    let id = new URL(worker.url()).hostname;
    let options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
    await expect(options.getByRole('heading', { name: '利用前の確認' })).toBeVisible();
    for (const [name, url] of [
      ['プライバシーポリシー（案）', 'https://github.com/shinjo15/agent_moderator/blob/main/docs/privacy.md'],
      ['YouTube利用規約', 'https://www.youtube.com/t/terms'],
      ['Googleプライバシーポリシー', 'https://policies.google.com/privacy'],
    ]) await expect(options.getByRole('link', { name, exact: true })).toHaveAttribute('href', url);
    await expect(options.getByTestId('confirmation-status')).toContainText('未同意');
    await expect(options.getByText(/投稿者本人の同意ではありません/)).toBeVisible();
    const confirm = options.getByRole('button', { name: '同意を保存', exact: true });
    await expect(confirm).toBeDisabled();
    await options.getByLabel('YouTube APIキー').fill('synthetic-unsent');
    await options.getByRole('button', { name: 'YouTubeキーを保存', exact: true }).click();
    await expect(options.getByTestId('youtube-status')).toHaveText('設定済み');
    await options.getByLabel('フィルターの強さ', { exact: true }).selectOption('custom');
    await options.getByLabel('判定の基準値', { exact: true }).fill('0.731');
    await options.getByRole('button', { name: 'フィルター設定を保存', exact: true }).click();
    await expect(options.getByTestId('filter-status')).toContainText('判定の基準値 0.731');
    const second = await context.newPage(); await second.goto(options.url());
    await options.getByLabel('利用規約（案）とプライバシーポリシー（案）に同意し、データ送信・費用の説明を確認しました', { exact: true }).check();
    await confirm.click();
    await expect(options.getByTestId('confirmation-status')).toContainText('同意済み');
    await expect(second.getByTestId('confirmation-status')).toContainText('同意済み');
    expect(await options.evaluate(() => chrome.runtime.sendMessage({ type: 'confirmation.get' })))
      .toEqual({ ok: true, value: { confirmed: true, version: 2 } });
    expect(await worker.evaluate(async () => (await chrome.storage.local.get(['usage.confirmation']))['usage.confirmation']))
      .toEqual({ version: 2 });
    await context.close(); context = await launch();
    worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); id = new URL(worker.url()).hostname;
    options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
    await expect(options.getByTestId('confirmation-status')).toContainText('同意済み');
    await expect(options.getByTestId('youtube-status')).toHaveText('設定済み');
    await expect(options.getByTestId('filter-status')).toContainText('判定の基準値 0.731');
    await options.getByRole('button', { name: 'YouTubeキーを削除', exact: true }).click();
    await expect(options.getByTestId('youtube-status')).toContainText('未設定');
    expect(await options.evaluate(() => chrome.runtime.sendMessage({ type: 'confirmation.get' }))).toMatchObject({ ok: true, value: { confirmed: true } });
    await worker.evaluate(() => chrome.storage.local.set({ 'usage.confirmation': { version: 1 } }));
    await expect(options.getByTestId('confirmation-status')).toContainText('未同意');
    await expect(options.getByLabel('利用規約（案）とプライバシーポリシー（案）に同意し、データ送信・費用の説明を確認しました', { exact: true })).not.toBeChecked();
    expect(await options.evaluate(() => chrome.runtime.sendMessage({ type: 'confirmation.confirm', version: 1 }))).toMatchObject({ ok: false });
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('確認準備write成功・readback拒否・rollback拒否の後もブラウザ再起動で未確認を維持する', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-confirmation-fault-'));
  const extension = resolve('dist');
  const launch = () => chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  let context = await launch();
  try {
    let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    let id = new URL(worker.url()).hostname;
    let options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
    await expect(options.getByTestId('confirmation-status')).toContainText('未同意');
    await worker.evaluate(() => {
      const get = chrome.storage.local.get.bind(chrome.storage.local);
      const set = chrome.storage.local.set.bind(chrome.storage.local);
      let written = false;
      chrome.storage.local.set = async values => {
        if (!('usage.confirmation' in values)) return set(values);
        if (written) throw new Error('rollback refused');
        await set(values); written = true;
      };
      chrome.storage.local.get = async keys => {
        if (written && keys.includes('usage.confirmation')) throw new Error('readback refused');
        return get(keys);
      };
    });
    expect(await options.evaluate(() => chrome.runtime.sendMessage({ type: 'confirmation.confirm', version: 2 }))).toMatchObject({ ok: false });
    expect(await options.evaluate(() => chrome.runtime.sendMessage({ type: 'confirmation.get' }))).toMatchObject({ ok: true, value: { confirmed: false } });
    await context.close(); context = await launch();
    worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); id = new URL(worker.url()).hostname;
    options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
    await expect(options.getByTestId('confirmation-status')).toContainText('未同意');
    expect(await worker.evaluate(async () => (await chrome.storage.local.get(['usage.confirmation']))['usage.confirmation'])).toEqual({ version: -1 });
    expect(await options.evaluate(() => chrome.runtime.sendMessage({ type: 'confirmation.confirm', version: 2 }))).toMatchObject({ ok: true, value: { confirmed: true } });
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
