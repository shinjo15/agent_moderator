import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
declare const chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
declare const hiddenFixture: { mode(value: string): void; release(): void; hold(): void; target(): void };
const author = 'UCabcdefghijklmnopqrstuv'; const other = 'UCzyxwvutsrqponmlkjihgfe';
const body = '<img src=x onerror=alert(1)>\n登録時の本文😀' + '長文'.repeat(2100);
for (const locale of ['ja', 'en']) test(`hidden comments ${locale}: 同一snapshotの人数/状態、空本文/欠落、長文/XSS/狭幅/解除/nav`, async () => {
  const profile = await mkdtemp(join(tmpdir(), 'am-hidden-comments-')); const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, locale,
    env: { ...process.env, LANGUAGE: locale, LANG: `${locale}_${locale.toUpperCase()}.UTF-8` },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const page = await context.newPage(); await page.clock.install();
    await page.addInitScript(({ author, other, body }) => {
      let mode = 'hold'; let video = 'zyxwvutsrqp'; let release!: () => void;
      let held: Promise<void> | undefined = new Promise<void>(done => { release = done; });
      let ids = [author, other, 'UC2222222222222222222222'];
      Object.assign(globalThis, { hiddenFixture: {
        mode(value: string) { mode = value; },
        release() { held = undefined; release(); },
        hold() { held = new Promise<void>(done => { release = done; }); },
        target() { video = 'finalvideo1'; ids = [author]; mode = 'ready'; held = undefined; },
      } });
      chrome.runtime.sendMessage = async request => {
        const m = request as { type: string; authorChannelId?: string };
        if (m.type === 'youtube.status') return mode === 'none' ? { ok: false } : { ok: true, value: { videoId: video, credentialsAvailable: true } };
        if (m.type === 'hidden.remove') { ids = ids.filter(id => id !== m.authorChannelId); return { ok: true }; }
        if (m.type === 'hidden.list') {
          if (mode === 'error') throw new Error('synthetic');
          if (mode === 'unresolved') return { ok: false, code: 'scopeUnresolved' };
          if (mode === 'duplicate') return { ok: true, videoId: 'zyxwvutsrqp', ids: [author, author] };
          const selected = mode === 'empty' ? [] : ids;
          const result = { ok: true, videoId: video, ids: selected, authors: selected.map(authorChannelId => ({ authorChannelId, displayName: '同名',
            ...(authorChannelId === author ? { triggerComment: { text: video === 'finalvideo1' ? '新対象の登録時本文' : body, videoId: 'abcdefghijk' } }
              : authorChannelId === other ? { triggerComment: { text: '', videoId: 'zyxwvutsrqp' } } : {}) })) };
          await held; return result;
        }
        return { ok: true };
      };
    }, { author, other, body });
    await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/monitor.html`);
    const button = page.getByRole('button', { name: locale === 'ja' ? '非表示一覧' : 'Hidden authors', exact: true });
    const badge = button.locator('.hidden-count-badge');
    await expect(badge).toHaveText('…');
    await expect(button).toHaveAccessibleDescription(locale === 'ja' ? /確認中/ : /Checking/);
    await page.evaluate(() => { hiddenFixture.mode('ready'); hiddenFixture.release(); });
    await expect(badge).toHaveText('3');
    await expect(button).toHaveAccessibleDescription(locale === 'ja' ? /3人/ : /3/);
    await page.setViewportSize({ width: 360, height: 640 }); await button.click();
    const rows = page.locator('#hidden-authors > li');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0).locator('.hidden-trigger-text')).toHaveText(body);
    await expect(rows.nth(1).locator('.hidden-trigger-text')).toHaveText('');
    await expect(rows.nth(1)).toContainText(locale === 'ja' ? '本文は空です' : 'Comment text is empty');
    await expect(rows.nth(2)).toContainText(locale === 'ja' ? '確認できません' : 'unavailable');
    await expect(rows.nth(0)).toContainText(locale === 'ja' ? '非表示時のコメント' : 'Comment that triggered hiding');
    await expect(page.locator('#hidden-authors img, #hidden-authors script, #hidden-authors a')).toHaveCount(0);
    expect(await page.locator('.hidden-dialog').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    expect(await rows.nth(0).locator('.hidden-trigger-text').evaluate(e => getComputedStyle(e).whiteSpace)).toBe('pre-wrap');
    const remove = rows.nth(2).getByRole('button'); await expect(remove).toBeVisible(); await remove.click();
    await expect(badge).toHaveText('2'); await expect(rows).toHaveCount(2); await page.keyboard.press('Escape');
    for (const mode of ['error', 'duplicate', 'unresolved', 'empty']) {
      await page.evaluate(value => hiddenFixture.mode(value), mode); await page.clock.runFor(1100);
      await expect(badge).toHaveText(mode === 'empty' ? '0' : mode === 'unresolved' ? '…' : '!');
      await expect(button).toHaveAccessibleDescription(locale === 'ja' ? mode === 'empty' ? /0人/ : mode === 'unresolved' ? /確認中/ : /確認できません/ : mode === 'empty' ? /0/ : mode === 'unresolved' ? /Checking/ : /Could not verify/);
      if (mode !== 'empty') {
        // Recover the same authors/signature, including the original nonempty body.
        await button.click(); await expect(page.locator('#hidden-authors')).toBeHidden();
        await page.evaluate(() => hiddenFixture.mode('ready')); await page.clock.runFor(1100);
        await expect(badge).toHaveText('2'); await expect(rows).toHaveCount(2);
        await expect(rows.nth(0).locator('.hidden-trigger-text')).toBeVisible();
        await expect(rows.nth(0).locator('.hidden-trigger-text')).toHaveText(body);
        await expect(button).toHaveAccessibleDescription(locale === 'ja' ? /2人/ : /2/);
        await page.keyboard.press('Escape');
      }
    }
    await page.evaluate(() => { hiddenFixture.mode('ready'); hiddenFixture.hold(); });
    await page.clock.runFor(1100); // Old read captures two authors and their original body.
    await page.evaluate(() => hiddenFixture.target());
    await worker.evaluate(() => chrome.runtime.sendMessage({ type: 'youtube.targetChanged' }));
    await expect(page.locator('.viewer-header')).toContainText('finalvideo1');
    await expect(badge).toHaveText('1'); await expect(rows).toHaveCount(1);
    await expect(rows.nth(0).locator('.hidden-trigger-text')).toHaveText('新対象の登録時本文');
    await page.evaluate(() => hiddenFixture.release()); await page.clock.runFor(20);
    await expect(badge).toHaveText('1'); await expect(rows).toHaveCount(1);
    await expect(rows.nth(0).locator('.hidden-trigger-text')).toHaveText('新対象の登録時本文');
    await expect(page.locator('#hidden-authors')).not.toContainText(body);
    await page.evaluate(() => hiddenFixture.mode('none'));
    await worker.evaluate(() => chrome.runtime.sendMessage({ type: 'youtube.targetChanged' }));
    await expect(badge).toHaveText('—');
    await expect(button).toHaveAccessibleDescription(locale === 'ja' ? /対象配信/ : /Select a target/);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
