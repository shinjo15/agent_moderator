import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { apiResponse } from '../tests/fixtures/jev';

declare const chrome: { i18n: { getUILanguage(): string }; action: { openPopup(): Promise<void> }; tabs: { create(options: { url: string; active: boolean }): Promise<unknown> }; runtime: { sendMessage(message: unknown): Promise<unknown> } };

async function layout(page: import('@playwright/test').Page) {
  const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll<HTMLElement>('main, section, p, button, dialog[open]')]
      .filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1).map(element => element.tagName),
  }));
  expect(measured.scrollWidth).toBeLessThanOrEqual(measured.width);
  expect(measured.overflowing).toEqual([]);
  return measured;
}

for (const locale of ['ja', 'en', 'fr']) {
  test(`実MV3 ${locale}: Chrome UI言語とpopup表示`, async () => {
    test.setTimeout(60000);
    const profile = await mkdtemp(join(tmpdir(), 'moderator-i18n-'));
    const extension = resolve('dist');
    const definitionPath = join(extension, 'jev-questions.json');
    const originalDefinition = await readFile(definitionPath, 'utf8');
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true, locale,
      env: { ...process.env, LANGUAGE: locale, LANG: `${locale}_${locale.toUpperCase()}.UTF-8` },
      args: ['--enable-unsafe-extension-debugging', `--lang=${locale}`, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    });
    try {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
      const measuredLocale = await worker.evaluate(() => chrome.i18n.getUILanguage());
      expect(measuredLocale).toMatch(new RegExp(`^${locale}(-|$)`));
      console.log(`MV3 requested=${locale} chrome.i18n.getUILanguage=${measuredLocale}`);
      const id = new URL(worker.url()).hostname;
      await worker.evaluate(() => chrome.action.openPopup());
      const cdp = await context.browser()!.newBrowserCDPSession();
      const { targetInfos: popupTargets } = await cdp.send('Target.getTargets');
      const target = popupTargets.find(target => target.url === `chrome-extension://${id}/popup.html`)!;
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
      const popupMeasurement = new Promise<{ result: { result: { value: { width: number; scrollWidth: number; popup: boolean; language: string } } } }>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('popup measurement timeout')), 5000);
        cdp.on('Target.receivedMessageFromTarget', event => {
          const response = JSON.parse(event.message);
          if (event.sessionId === sessionId && response.id === 1) { clearTimeout(timer); resolve(response); }
        });
      });
      await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: {
        expression: `new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,popup:chrome.extension.getViews({type:'popup'}).includes(window),language:chrome.i18n.getUILanguage()}))))`,
        awaitPromise: true, returnByValue: true,
      } }) });
      expect((await popupMeasurement).result.result.value).toEqual({ width: 480, scrollWidth: 480, popup: true, language: measuredLocale });
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/popup.html`);
      await expect(page.getByRole('button', { name: locale === 'ja' ? '設定を開く' : 'Open settings', exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', locale === 'ja' ? 'ja' : 'en');
      await page.getByRole('button', { name: locale === 'ja' ? '設定を開く' : 'Open settings', exact: true }).click();
      await expect(page.getByRole('heading', { name: locale === 'ja' ? 'Agent Moderator 設定' : 'Agent Moderator settings', exact: true })).toBeVisible();
      await expect(page.getByLabel(locale === 'ja' ? 'Jev APIキー' : 'Jev API key', { exact: true })).toHaveAttribute('placeholder', locale === 'ja' ? 'Jev APIキーを入力' : 'Enter Jev API key');
      await expect(page.getByTestId('filter-status')).toContainText(locale === 'ja' ? '現在の設定' : 'Current setting');
      await expect(page.getByTestId('confirmation-status')).toContainText(locale === 'ja' ? '未同意' : 'Not agreed');
      await expect(page.getByRole('button', { name: locale === 'ja' ? '同意を保存' : 'Save agreement', exact: true })).toBeDisabled();
      await expect(page.locator('.sending-disclosure')).toContainText('TypeSafe AI');
      await expect(page.locator('.sending-disclosure')).toContainText('60');
      await expect(page.locator('.sending-disclosure')).toContainText('20');
      if (locale !== 'ja') {
        await expect(page.locator('.sending-disclosure')).toContainText('personal information');
        await expect(page.locator('.sending-disclosure')).toContainText('charges');
        await expect(page.locator('body')).not.toContainText(/[ぁ-んァ-ヶ一-龠]/);
      }
      await expect(page.getByLabel(locale === 'ja' ? 'Jev APIキー' : 'Jev API key', { exact: true })).toHaveAccessibleDescription(locale === 'ja' ? 'コメントのAI判定に使います。チャット画面でJev判定を有効にすると利用します。' : 'Used for AI evaluation of comments when you enable Jev evaluation on the chat screen.');
      await layout(page);
      await page.getByRole('button', { name: locale === 'ja' ? '全配信の非表示データを削除' : 'Delete hidden data for all streams', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('button', { name: locale === 'ja' ? 'キャンセル' : 'Cancel', exact: true })).toBeFocused();
      const confirm = page.getByRole('button', { name: locale === 'ja' ? '削除する' : 'Delete', exact: true });
      await confirm.hover();
      await expect(confirm).toHaveCSS('background-color', 'rgb(185, 28, 28)');
      await layout(page);
      await page.goto(`chrome-extension://${id}/monitor.html`);
      await expect(page.getByRole('heading', { name: locale === 'ja' ? 'YouTubeライブチャット取得' : 'YouTube live chat collection', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: locale === 'ja' ? 'Jev判定を有効化・再開' : 'Enable / resume Jev evaluation', exact: true })).toBeVisible();
      await expect(page.getByRole('heading', { name: locale === 'ja' ? 'この配信の非表示投稿者' : 'Hidden authors in this stream', exact: true })).toBeVisible();
      await layout(page);
      await page.goto(`chrome-extension://${id}/terms.html`);
      await expect(page).toHaveTitle(locale === 'ja' ? 'Agent Moderator 利用規約（案）' : 'Agent Moderator terms of use (draft)');
      await expect(page.getByRole('heading', { level: 2 })).toHaveCount(9);
      await expect(page.locator('.draft-notice')).toContainText(locale === 'ja' ? '施行日：未定' : 'Effective date: undecided');
      await expect(page.locator('html')).toHaveAttribute('lang', locale === 'ja' ? 'ja' : 'en');
      if (locale !== 'ja') await expect(page.locator('main')).not.toContainText(/[ぁ-んァ-ヶ一-龠]/);
      await expect(page.locator('main a')).toHaveCount(7);
      await layout(page);
      // Fixture-routed real MV3 path. No real API or natural-language accuracy claim.
      let externalRequests = 0;
      const payloads: Record<string, unknown>[] = [];
      let collection = 0;
      await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>YouTube fixture</h1>' }));
      await context.route('https://www.googleapis.com/youtube/v3/**', route => {
        externalRequests++;
        if (new URL(route.request().url()).pathname.endsWith('/videos')) return route.fulfill({ json: { items: [{ id: 'abcdefghijk', liveStreamingDetails: { activeLiveChatId: 'fixture' } }] } });
        collection++;
        return route.fulfill({ json: { nextPageToken: 'next', pollingIntervalMillis: 5000, items: [{ id: `target-${collection}`, authorDetails: { channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', displayName: 'あおい / Aoi' }, snippet: { type: 'textMessageEvent', hasDisplayContent: true, displayMessage: '日本語の投稿 Keep original', publishedAt: '2026-01-01T00:00:00.000Z' } }] } });
      });
      await context.route('https://api.typesafe.ai/v1/systemone', route => {
        externalRequests++;
        payloads.push(route.request().postDataJSON());
        return route.fulfill({ json: apiResponse({ attack: 0.9 }) });
      });
      await page.goto(`chrome-extension://${id}/options.html`);
      for (const provider of ['Jev', 'YouTube']) {
        await page.getByLabel(locale === 'ja' ? `${provider} APIキー` : `${provider} API key`, { exact: true }).fill(`synthetic-${provider}`);
        await page.getByRole('button', { name: locale === 'ja' ? `${provider}キーを保存` : `Save ${provider} key`, exact: true }).click();
      }
      const youtube = await context.newPage(); await youtube.goto('https://www.youtube.com/watch?v=abcdefghijk'); await youtube.bringToFront();
      const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
      const tab = targetInfos.find(target => target.type === 'tab' && target.url === youtube.url())!;
      await cdp.send('Extensions.triggerAction', { id, targetId: tab.targetId });
      const popupPromise = context.waitForEvent('page');
      await worker.evaluate(id => chrome.tabs.create({ url: `chrome-extension://${id}/popup.html`, active: false }), id);
      const popup = await popupPromise;
      const monitorPromise = context.waitForEvent('page');
      await popup.getByRole('button', { name: locale === 'ja' ? 'この動画のチャットを取得' : 'Collect chat for this video', exact: true }).click();
      const monitor = await monitorPromise;
      const enable = monitor.getByRole('button', { name: locale === 'ja' ? 'Jev判定を有効化・再開' : 'Enable / resume Jev evaluation', exact: true });
      const start = monitor.getByRole('button', { name: locale === 'ja' ? '取得を開始' : 'Start collection', exact: true });
      await enable.click(); await start.click();
      await expect(monitor.getByRole('status')).toContainText(locale === 'ja' ? '同意' : 'agree');
      expect(externalRequests).toBe(0);
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: locale === 'ja' ? '同意を保存' : 'Save agreement', exact: true }).click();
      await expect(page.getByTestId('confirmation-status')).toContainText(locale === 'ja' ? '同意済み' : 'Agreed');
      await expect(monitor.getByRole('status')).toContainText(locale === 'ja' ? '同意状態が変更' : 'agreement status changed');
      expect(externalRequests).toBe(0);
      await enable.click(); await start.click();
      await expect(monitor.locator('.score-badge')).toHaveText(locale === 'ja' ? '判定スコア 0.90' : 'Evaluation score 0.90', { timeout: 15000 });
      expect(payloads).toHaveLength(1);
      expect(Object.keys(payloads[0]).sort()).toEqual(['model', 'questions', 'state']);
      expect(payloads[0].model).toBe('jev-latest');
      expect(payloads[0].questions).toEqual(JSON.parse(originalDefinition));
      expect(payloads[0].state).toEqual({ target: { text: '日本語の投稿 Keep original', publishedAt: '2026-01-01T00:00:00.000Z' }, history: [] });
      // Frozen main908cab0 questions: every instruction, criterion, type and category.
      expect(createHash('sha256').update(JSON.stringify(payloads[0].questions)).digest('hex')).toBe('b520a1d214bd3131d768410605704fa3ffa4b8d22ebd00d384e7efb96817745b');
      await expect(monitor.locator('.chat-text')).toHaveText('日本語の投稿 Keep original');
      await expect(monitor.locator('.chat-author .author-name')).toHaveText('あおい / Aoi');
      await monitor.getByText(locale === 'ja' ? '項目別スコア' : 'Category scores', { exact: true }).click();
      await expect(monitor.locator('.score-details dt').first()).toHaveText(locale === 'ja' ? '人への攻撃、侮辱、人格否定' : 'Attacks, insults or denigration of a person');
      const unhide = monitor.getByRole('button', { name: locale === 'ja' ? 'あおい / Aoi（投稿者ID：UCaaaaaaaaaaaaaaaaaaaaaa）の非表示を解除' : 'Unhide あおい / Aoi (author ID: UCaaaaaaaaaaaaaaaaaaaaaa)', exact: true });
      await expect(unhide).toBeVisible();
      await layout(monitor);
      await unhide.click();
      await expect(monitor.locator('#hidden-authors > li')).toHaveCount(0);
      await monitor.getByRole('button', { name: locale === 'ja' ? '取得を停止' : 'Stop collection', exact: true }).click();
      await page.getByRole('button', { name: locale === 'ja' ? '全配信の非表示データを削除' : 'Delete hidden data for all streams', exact: true }).click();
      await page.getByRole('button', { name: locale === 'ja' ? '削除する' : 'Delete', exact: true }).click();
      await expect(page.getByTestId('hidden-clear-status')).toContainText(locale === 'ja' ? '削除しました' : 'Deleted');
      await writeFile(definitionPath, 'not json');
      const sent = payloads.length;
      await enable.click(); await start.click();
      await expect(monitor.getByTestId('jev-status')).toContainText(locale === 'ja' ? '判定定義を読み込めませんでした' : 'Could not load the Jev evaluation definition', { timeout: 12000 });
      await expect(monitor.getByTestId('jev-status')).toContainText(locale === 'ja' ? '自動では再開しません' : 'will not resume automatically');
      await expect(enable).toBeEnabled();
      expect(payloads).toHaveLength(sent);
      await writeFile(definitionPath, originalDefinition);
      await enable.click();
      await expect.poll(() => payloads.length, { timeout: 12000 }).toBeGreaterThan(sent);
      expect(payloads.at(-1)?.questions).toEqual(JSON.parse(originalDefinition));
    } finally {
      await writeFile(definitionPath, originalDefinition);
      expect(await readFile(definitionPath, 'utf8')).toBe(originalDefinition);
      await context.close(); await rm(profile, { recursive: true, force: true });
    }
  });
}
