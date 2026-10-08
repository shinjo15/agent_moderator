import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

declare const chrome: {
  action: { openPopup(): Promise<void> };
  runtime: { sendMessage(message: unknown): Promise<unknown>; reload(): void };
  storage: { local: {
    get(keys: string[] | null): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
    remove(keys: string[]): Promise<void>;
  } };
};

test('実action popupは幅480pxで横スクロールなしに表示される', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-popup-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: null,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).hostname;
    await worker.evaluate(() => chrome.action.openPopup());
    const cdp = await context.browser()!.newBrowserCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets');
    const target = targetInfos.find(target => target.url === `chrome-extension://${extensionId}/popup.html`);
    expect(target).toBeDefined();
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target!.targetId, flatten: false });
    const measurement = new Promise<{ result: { result: { value: { width: number; scrollWidth: number; isPopup: boolean } } } }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('実popupのCDP測定がタイムアウトしました。')), 5_000);
      cdp.on('Target.receivedMessageFromTarget', event => {
        const message = JSON.parse(event.message);
        if (event.sessionId === sessionId && message.id === 1) {
          clearTimeout(timer);
          resolve(message);
        }
      });
    });
    await cdp.send('Target.sendMessageToTarget', {
      sessionId,
      message: JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
        expression: `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          isPopup: chrome.extension.getViews({ type: 'popup' }).includes(window)
        }))))`,
        awaitPromise: true, returnByValue: true,
      } }),
    });
    const { width, scrollWidth, isPopup } = (await measurement).result.result.value;
    expect(isPopup).toBe(true);
    expect(width).toBe(480);
    expect(scrollWidth).toBe(width);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});

test('実際のMV3拡張を読み込み、設定buttonから同じpageで設定を開ける', async () => {
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
    await expect(page.getByText('非表示は配信ごとに、あなたの画面だけに適用されます。停止しても非表示は続き、チャット画面の一覧から解除できます。YouTube上のBANやコメント削除はしません。', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Jev APIキー')).toHaveAttribute('type', 'password');
    await expect(page.getByLabel('YouTube APIキー')).toHaveAttribute('type', 'password');
    const notice = page.locator('.settings-notice');
    await expect.soft(page.getByText('保存後、入力欄は空欄になります。保存済みキーは表示しません。空欄で保存すると既存キーを保持します。', { exact: true })).toHaveCount(0);
    await expect(notice).toHaveCSS('font-size', '12px');
    for (const [name, purpose] of [['Jev', 'コメント判定'], ['YouTube', 'チャット取得']]) {
      const card = page.getByRole('region', { name: `${name}：${purpose}` });
      await expect(card).toBeVisible();
      await expect(card.getByRole('heading', { name: `${name}：${purpose}` })).toBeVisible();
      const input = card.getByLabel(`${name} APIキー`, { exact: true });
      await expect(input).toHaveAttribute('placeholder', `${name} APIキーを入力`);
      await expect(input).toHaveAttribute('autocomplete', 'off');
      const descriptionId = `${name === 'Jev' ? 'jev' : 'youtube'}-description`;
      const descriptionText = name === 'Jev' ?
        'コメントのAI判定に使います。チャット画面でJev判定を有効にすると利用します。' :
        'ライブチャットの取得に使います。「取得を開始」を押すと利用します。';
      await expect.soft(input).toHaveAccessibleDescription(descriptionText);
      await expect.soft(input).toHaveAttribute('aria-describedby', descriptionId);
      await expect.soft(card.locator(`#${descriptionId}`)).toHaveCSS('font-size', '12px');
      expect(await input.evaluate(element => (element.getAttribute('aria-describedby') ?? '').split(/\s+/)
        .every(id => Boolean(document.getElementById(id))))).toBe(true);
      const save = card.getByRole('button', { name: `${name}キーを保存`, exact: true });
      const remove = card.getByRole('button', { name: `${name}キーを削除`, exact: true });
      await expect(save).toHaveAttribute('type', 'button');
      await expect(remove).toHaveAttribute('type', 'button');
      const geometry = await input.evaluate(element => {
        const section = element.closest('section')!;
        const sectionStyle = getComputedStyle(section);
        const card = section.getBoundingClientRect();
        const label = section.querySelector('label')!;
        const input = element.getBoundingClientRect();
        return {
          labelDisplay: getComputedStyle(label).display,
          labelAboveInput: label.getBoundingClientRect().bottom <= input.top,
          inputHeight: input.height,
          fullWidth: Math.abs(input.width - (card.width - parseFloat(sectionStyle.paddingLeft) - parseFloat(sectionStyle.paddingRight) - parseFloat(sectionStyle.borderLeftWidth) - parseFloat(sectionStyle.borderRightWidth))) < 1,
          borderStyle: sectionStyle.borderTopStyle,
          borderWidth: parseFloat(sectionStyle.borderTopWidth),
          statusIsSeparate: section.querySelector('p[data-testid]')?.parentElement === section,
        };
      });
      expect(geometry.labelDisplay).toBe('block');
      expect(geometry.labelAboveInput).toBe(true);
      expect(geometry.inputHeight).toBeGreaterThanOrEqual(44);
      expect(geometry.fullWidth).toBe(true);
      expect(geometry.borderStyle).toBe('solid');
      expect(geometry.borderWidth).toBeGreaterThanOrEqual(1);
      expect(geometry.statusIsSeparate).toBe(true);
      const cardRect = await card.boundingBox();
      const noticeRect = await notice.boundingBox();
      expect(cardRect!.y + cardRect!.height).toBeLessThanOrEqual(noticeRect!.y);
      await expect(remove).toHaveCSS('background-color', 'rgb(185, 28, 28)');
      await remove.hover();
      await expect(remove).toHaveCSS('background-color', 'rgb(185, 28, 28)');
      await expect(save).not.toHaveCSS('background-color', 'rgb(185, 28, 28)');
    }
    await page.getByLabel('Jev APIキー').fill('synthetic-long-key-'.repeat(100));
    const layout = await page.evaluate(() => {
      const body = document.body;
      const style = getComputedStyle(body);
      const content = document.querySelector('main')!.getBoundingClientRect();
      return {
        width: body.getBoundingClientRect().width,
        padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
        lineHeight: parseFloat(style.lineHeight) / parseFloat(style.fontSize),
        overflowWrap: style.overflowWrap,
        contentOverflows: [...document.querySelectorAll<HTMLElement>('main, section, p')]
          .some(element => element.scrollWidth > element.clientWidth),
        inputOverflows: [...document.querySelectorAll('input')].some(input => {
          const rect = input.getBoundingClientRect();
          return rect.left < content.left || rect.right > content.right;
        }),
      };
    });
    expect(layout).toEqual({
      width: 480,
      padding: ['16px', '16px', '16px', '16px'],
      lineHeight: 1.5,
      overflowWrap: 'anywhere',
      contentOverflows: false,
      inputOverflows: false,
    });
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
    await expect(page.getByRole('status')).toHaveText('APIキーの保存処理が完了しました。有効性は確認していません。');
    expect(await worker.evaluate(async () => (await chrome.storage.local.get(['apiKey.jev']))['apiKey.jev'] === 'synthetic-jev-replacement')).toBe(true);
    await page.getByRole('button', { name: 'YouTubeキーを保存' }).click();
    await expect(page.getByRole('status')).toHaveText('APIキーの保存処理が完了しました。有効性は確認していません。');
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
    await expect(page.getByText('取得を停止しても非表示は続き、チャット画面で解除できます。YouTube上のBANやコメント削除はしません。', { exact: true })).toBeVisible();
    const settings = page.getByRole('button', { name: '設定を開く', exact: true });
    await expect(settings).toHaveAttribute('type', 'button');
    const pagesBeforeClick = context.pages();
    await settings.click();
    await expect(page).toHaveURL(`chrome-extension://${extensionId}/${manifest.options_ui.page}`);
    await expect(page.getByRole('heading', { name: 'Agent Moderator 設定' })).toBeVisible();
    expect(context.pages()).toEqual(pagesBeforeClick);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
