import { expect, type Page } from '@playwright/test';

// Exercise the production confirmation UI, never seed an approved state silently.
export async function confirmUsage(options: Page) {
  await options.getByLabel('利用規約（案）とプライバシーポリシー（案）に同意し、データ送信・費用の説明を確認しました', { exact: true }).check();
  await options.getByRole('button', { name: '同意を保存', exact: true }).click();
  await expect(options.getByTestId('confirmation-status')).toContainText('同意済み');
}
