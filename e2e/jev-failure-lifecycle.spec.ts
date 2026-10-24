import { test, expect, chromium, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';

// Deferred API fixture failures, not live Jev responses.
declare const failureFixture: {
  observe(id: string): void; add(id: string): void; remove(): void; release(): void; requests(): number;
  evaluate(id: string): Promise<unknown>;
};
async function withPanel(run: (page: Page) => Promise<void>, realCore = false) {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), sourcefile: 'jev-failure-fixture.ts', loader: 'ts', contents: `
    import { createJevPanel } from './src/jev/monitor';
    import { createModerationTransport } from './src/jev/runtime-transport';
    import { createModeration } from './src/jev/moderation';
    import { createJevClient } from './src/jev/client';
    import { apiResponse, chatPost } from './tests/fixtures/jev';
    let release = () => {};
    let requests = 0;
    let row: HTMLElement;
    const core = ${realCore} ? createModeration({ readConfirmation: async () => true, readKey: async () => 'synthetic', client: createJevClient(async () => {
      requests++;
      if (requests === 1) {
        await new Promise<void>(resolve => { release = resolve; });
        return new Response('{}', { status: 429, headers: { 'Retry-After': '30' } });
      }
      return new Response(JSON.stringify(apiResponse()));
    }, async () => (${readFileSync('public/jev-questions.json', 'utf8')})) }) : undefined;
    const transport = createModerationTransport({ async sendMessage(request) {
      if (core) {
        if (request.type === 'jev.enable') return core.enable();
        if (request.type === 'jev.disable') { core.stop(); return { ok: true }; }
        if (request.type === 'jev.evaluate') return core.evaluate(request.id);
      }
      if (request.type !== 'jev.evaluate') return { ok: true };
      requests++;
      await new Promise<void>(resolve => { release = resolve; });
      return { ok: true, value: { id: request.id, authorChannelId: 'fixture-author',
        burst: 'notObserved', reasons: [], jev: 'failed', error: { code: 'rateLimited', retryAfterMillis: 30000 } } };
    } });
    const main = document.createElement('main'); document.body.append(main);
    const panel = createJevPanel(main, transport); panel.setTarget(true);
    Object.assign(globalThis, { failureFixture: {
      observe(id: string) { core?.observe([{ ...chatPost(id, Date.now(), 'fixture-author'), authorDisplayName: '期限切れ名前fixture' }]); },
      evaluate(id: string) { return transport.evaluate(id, 'fixture-author'); },
      add(id: string) { core?.observe([chatPost(id, Date.now(), 'fixture-author')]); row = document.createElement('li'); main.append(row); panel.add(id, 'fixture-author', row); },
      remove() { panel.remove(row); }, release() { release(); }, requests() { return requests; },
    } });
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const page = await browser.newPage();
    await page.clock.install();
    await page.goto('about:blank');
    // Isolated panel fixture, not an extension page: explicitly supply Japanese
    // Chrome i18n instead of adding a Japanese fallback to production code.
    await page.evaluate(messages => {
      Object.assign(globalThis, { chrome: { i18n: {
        getUILanguage: () => 'ja',
        getMessage: (key: string, substitutions: string[] = []) =>
          messages[key]?.message.replace(/\$(\d)/g, (_: string, index: string) => substitutions[Number(index) - 1] ?? '') ?? '',
      } } });
    }, JSON.parse(await readFile('public/_locales/ja/messages.json', 'utf8')) as Record<string, { message: string }>);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await run(page);
  } finally { await browser.close(); }
}

for (const lifecycle of ['removed', 'expired'] as const) {
  test(`Jev current失敗は${lifecycle}行と独立に全体UIを停止し明示再開を表示する`, async () => {
    await withPanel(async page => {
      const enable = page.getByRole('button', { name: 'Jev判定を有効化・再開' });
      const disable = page.getByRole('button', { name: 'Jev判定を停止', exact: true });
      await enable.click();
      await expect(page.getByTestId('jev-status')).toContainText('有効');
      await page.evaluate(() => failureFixture.add('active'));
      expect(await page.evaluate(() => failureFixture.requests())).toBe(1);
      await expect(page.locator('.evaluation-summary')).toHaveAccessibleName(/判定中/);
      await expect(page.locator('.score-badge')).toHaveText('…');
      await expect(page.locator('.score-badge')).toHaveAttribute('data-state', 'neutral');
      await expect(page.locator('.evaluation-summary')).toBeVisible();
      await expect(page.locator('.message-details')).not.toHaveAttribute('open');
      if (lifecycle === 'removed') await page.evaluate(() => failureFixture.remove());
      else {
        await page.clock.runFor(60001);
        await expect(page.locator('.evaluation-summary')).toHaveAccessibleName(/未判定（期限切れ）/);
        await expect(page.locator('.moderation-status')).toContainText('判定の待ち時間を超えました');
      }
      await page.evaluate(() => failureFixture.release());
      await expect(page.getByTestId('jev-status')).toContainText('利用制限');
      await expect(page.getByTestId('jev-status')).toContainText('自動では再開しません');
      await expect(enable).toBeEnabled(); await expect(disable).toBeDisabled();
      expect(await page.evaluate(() => failureFixture.requests())).toBe(1);
      if (lifecycle === 'removed') await expect(page.locator('main > li')).toHaveCount(0);
      else {
        await expect(page.locator('.moderation-status')).toContainText('判定の待ち時間を超えました');
        await expect(page.locator('.evaluation-summary')).toHaveAccessibleName(/未判定（期限切れ）/);
      }
      await enable.click();
      await expect(page.getByTestId('jev-status')).toContainText('有効');
      await expect(enable).toBeDisabled(); await expect(disable).toBeEnabled();
    });
  });
}

test('Jev待機/queue full/TTL/停止は閉じた詳細と可視summaryで整合し再評価しない', async () => {
  await withPanel(async page => {
    await page.getByRole('button', { name: 'Jev判定を有効化・再開' }).click();
    await page.evaluate(() => {
      for (let index = 0; index < 202; index++) failureFixture.add(`queued-${index}`);
    });
    const rows = page.locator('main > li');
    await expect(rows.first().locator('.evaluation-summary')).toHaveAccessibleName(/判定中/);
    await expect(rows.nth(1).locator('.evaluation-summary')).toHaveAccessibleName(/未判定/);
    await expect(rows.nth(1).locator('.score-badge')).toHaveText('—');
    await expect(rows.nth(1).locator('.moderation-status')).toHaveText('未判定');
    await expect(rows.last().locator('.evaluation-summary')).toHaveAccessibleName(/未判定（上限）/);
    await expect(rows.last().locator('.moderation-status')).toContainText('判定待ちの上限');
    await expect(rows.last().locator('.evaluation-summary')).toBeVisible();
    await expect(page.locator('.message-details[open], .score-badge:not([data-state="neutral"])')).toHaveCount(0);
    expect(await page.evaluate(() => failureFixture.requests())).toBe(1);
    await page.clock.runFor(60001);
    await expect(rows.first().locator('.evaluation-summary')).toHaveAccessibleName(/未判定（期限切れ）/);
    await expect(rows.nth(1).locator('.evaluation-summary')).toHaveAccessibleName(/未判定（上限）/);
    await expect(rows.nth(1).locator('.moderation-status')).toContainText('待ち時間や表示件数の上限');
    await page.getByRole('button', { name: 'Jev判定を停止', exact: true }).click();
    await expect(rows.first().locator('.evaluation-summary')).toHaveAccessibleName(/未判定（停止）/);
    await page.evaluate(() => failureFixture.release()); await page.clock.runFor(100);
    await expect(rows.first().locator('.evaluation-summary')).toHaveAccessibleName(/未判定（停止）/);
    await expect(page.locator('.score-badge:not([data-state="neutral"])')).toHaveCount(0);
    expect(await page.evaluate(() => failureFixture.requests())).toBe(1);
  });
});

test('Jev旧世代失敗は削除後に再開した新世代UIを停止しない', async () => {
  await withPanel(async page => {
    const enable = page.getByRole('button', { name: 'Jev判定を有効化・再開' });
    const disable = page.getByRole('button', { name: 'Jev判定を停止', exact: true });
    await enable.click();
    await expect(page.getByTestId('jev-status')).toContainText('有効');
    await page.evaluate(() => failureFixture.add('old'));
    expect(await page.evaluate(() => failureFixture.requests())).toBe(1);
    await page.evaluate(() => failureFixture.remove());
    await disable.click(); await enable.click();
    await expect(page.getByTestId('jev-status')).toContainText('有効');
    await page.evaluate(() => failureFixture.release());
    await page.clock.runFor(100);
    await expect(page.getByTestId('jev-status')).toContainText('有効');
    await expect(enable).toBeDisabled(); await expect(disable).toBeEnabled();
  });
});

test('current観測TTL expiryの429を実client/core/runtime/panel経路で停止UIへ伝播する', async () => {
  await withPanel(async page => {
    const enable = page.getByRole('button', { name: 'Jev判定を有効化・再開' });
    const disable = page.getByRole('button', { name: 'Jev判定を停止', exact: true });
    await enable.click();
    await expect(page.getByTestId('jev-status')).toContainText('有効');
    await page.evaluate(() => failureFixture.observe('expired-current'));
    await page.clock.runFor(50000);
    await page.evaluate(() => failureFixture.add('expired-current'));
    await expect.poll(() => page.evaluate(() => failureFixture.requests())).toBe(1);
    await page.clock.runFor(10001);
    await page.evaluate(() => failureFixture.release());
    await expect(page.getByTestId('jev-status')).toContainText('利用制限');
    await expect(page.getByTestId('jev-status')).toContainText('自動では再開しません');
    await expect(enable).toBeEnabled(); await expect(disable).toBeDisabled();
    await expect(page.locator('.moderation-status')).toContainText('未判定 / Jev判定失敗');
    await expect(page.locator('.evaluation-summary')).toHaveAccessibleName(/判定失敗/);
    await expect(page.locator('.evaluation-summary')).toBeVisible();
    await expect(page.locator('.score-badge')).toHaveText('!');
    await expect(page.locator('.score-badge')).toHaveAttribute('data-state', 'neutral');
    await expect(page.locator('body')).not.toContainText('期限切れ名前fixture');
    expect(await page.evaluate(() => failureFixture.evaluate('expired-current'))).toBeUndefined();
    expect(await page.evaluate(() => failureFixture.requests())).toBe(1);
    await enable.click();
    await expect(page.getByTestId('jev-status')).toContainText('外部送信を停止');
    await page.clock.runFor(30000);
    expect(await page.evaluate(() => failureFixture.requests())).toBe(1);
    await enable.click();
    await expect(page.getByTestId('jev-status')).toContainText('有効');
    await page.evaluate(() => failureFixture.add('resumed-current'));
    await expect(page.locator('main > li').last()).toContainText('Jev判定済み');
    expect(await page.evaluate(() => failureFixture.requests())).toBe(2);
  }, true);
});

test('旧世代遅延429のcooldownは実client/coreの次通信を抑止しUI停止・期限後明示再開と整合する', async () => {
  await withPanel(async page => {
    const enable = page.getByRole('button', { name: 'Jev判定を有効化・再開' });
    const disable = page.getByRole('button', { name: 'Jev判定を停止', exact: true });
    await enable.click();
    await expect(page.getByTestId('jev-status')).toContainText('有効');
    await page.evaluate(() => failureFixture.add('old'));
    await expect.poll(() => page.evaluate(() => failureFixture.requests())).toBe(1);
    await disable.click(); await enable.click();
    await expect(page.getByTestId('jev-status')).toContainText('有効');
    await page.clock.runFor(60001);
    await page.evaluate(() => failureFixture.release());
    await page.clock.runFor(100);
    await expect(page.getByTestId('jev-status')).toContainText('有効');
    await expect(disable).toBeEnabled();
    await page.evaluate(() => failureFixture.add('suppressed'));
    await expect(page.getByTestId('jev-status')).toContainText('利用制限');
    await expect(page.getByTestId('jev-status')).toContainText('自動では再開しません');
    await expect(page.locator('main > li').last()).toContainText('未判定 / Jev判定失敗');
    await expect(page.locator('main > li').first().locator('.evaluation-summary')).toHaveAccessibleName(/未判定（停止）/);
    await expect(page.locator('main > li').last().locator('.evaluation-summary')).toHaveAccessibleName(/判定失敗/);
    await expect(page.locator('.score-badge:not([data-state="neutral"])')).toHaveCount(0);
    await expect(enable).toBeEnabled(); await expect(disable).toBeDisabled();
    expect(await page.evaluate(() => failureFixture.requests())).toBe(1);
    await enable.click();
    await expect(page.getByTestId('jev-status')).toContainText('外部送信を停止');
    await page.clock.runFor(30000);
    expect(await page.evaluate(() => failureFixture.requests())).toBe(1);
    await expect(disable).toBeDisabled();
    await enable.click();
    await expect(page.getByTestId('jev-status')).toContainText('有効');
    await page.evaluate(() => failureFixture.add('resumed'));
    await expect(page.locator('main > li').last()).toContainText('Jev判定済み');
    await expect(page.locator('main > li').last().locator('.evaluation-summary')).toHaveAccessibleName(/判定済み/);
    expect(await page.evaluate(() => failureFixture.requests())).toBe(2);
  }, true);
});
