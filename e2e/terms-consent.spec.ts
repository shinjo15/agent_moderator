import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
declare const chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };

const consent = '利用規約（案）とプライバシーポリシー（案）に同意し、データ送信・費用の説明を確認しました';

test('既存panel内で開発版の案へ明示同意し、同梱規約は未マージでも読める', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-terms-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
    const link = options.getByRole('link', { name: '利用規約（案）', exact: true });
    await expect(link).toHaveAttribute('href', `chrome-extension://${id}/terms.html`);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const checkbox = options.getByLabel(consent, { exact: true });
    const save = options.getByRole('button', { name: '同意を保存', exact: true });
    await expect(checkbox).not.toBeChecked(); await expect(save).toBeDisabled();
    await expect(options.getByText(/開発版での確認・同意/)).toBeVisible();
    const section = link.locator('xpath=ancestor::section');
    expect(await section.evaluate(element => {
      const disclosure = element.querySelector('.sending-disclosure')!;
      const checkbox = element.querySelector('input[type="checkbox"]')!;
      const button = element.querySelector('button')!;
      return Boolean(disclosure.compareDocumentPosition(checkbox) & Node.DOCUMENT_POSITION_FOLLOWING)
        && Boolean(checkbox.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING);
    })).toBe(true);
    await checkbox.check(); await expect(save).toBeEnabled();
    await checkbox.uncheck(); await expect(save).toBeDisabled();
    expect(await options.evaluate(() => chrome.runtime.sendMessage({ type: 'confirmation.get' })))
      .toEqual({ ok: true, value: { confirmed: false, version: 2 } });
    const opened = context.waitForEvent('page'); await link.click();
    const terms = await opened; await terms.waitForLoadState();
    expect(terms.url()).toBe(`chrome-extension://${id}/terms.html`);
    await expect(terms.getByRole('heading', { name: 'Agent Moderator 利用規約（案）', exact: true })).toBeVisible();
    await expect(terms.locator('main')).toContainText('施行日：未定');
    await expect(terms.locator('main')).toContainText('正式施行ではありません');
    await expect(terms.getByRole('link', { name: 'YouTube利用規約', exact: true })).toHaveAttribute('href', 'https://www.youtube.com/t/terms');
    await expect(terms.locator('script')).toHaveCount(0);
    expect(await options.evaluate(() => chrome.runtime.sendMessage({ type: 'confirmation.get' })))
      .toEqual({ ok: true, value: { confirmed: false, version: 2 } });
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
