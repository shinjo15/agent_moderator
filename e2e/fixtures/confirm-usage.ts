import { expect, type Page } from '@playwright/test';

// Exercise the production confirmation UI, never seed an approved state silently.
export async function confirmUsage(options: Page) {
  await options.getByLabel('利用条件・データの扱いを確認しました', { exact: true }).check();
  await options.getByRole('button', { name: '利用条件の確認を保存', exact: true }).click();
  await expect(options.getByTestId('confirmation-status')).toContainText('確認済み');
}
