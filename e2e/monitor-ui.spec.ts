import { test, expect, chromium, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { keys } from '../tests/fixtures/jev';

declare const chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
declare const monitorFixture: { append(): void; appendMany(count: number): void; hold(): void; release(): void; requests(): number; hide(): void };
const authorId = (id: string) => `UC${id.padEnd(22, '_')}`;

// Assigned UI fixture results, not live API output or model accuracy measurements.
async function withMonitor(run: (page: Page) => Promise<void>) {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-monitor-ui-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    await page.clock.install();
    await page.addInitScript(categories => {
      let batch = 0;
      let held: Promise<void> | undefined;
      let release = () => {};
      let requests = 0;
      let hidden: string[] = [];
      const special = ['zero', 'rounded', 'bad', 'disabled', 'burst', 'missing', 'failed'];
      const authorId = (id: string) => `UC${id.padEnd(22, '_')}`;
      const names: Record<string, string> = { zero: 'あおい', rounded: 'はるか', bad: 'みどり', disabled: 'さくら', burst: 'りん', missing: 'なお', failed: 'ゆう' };
      const message = (id: string) => ({ id, authorChannelId: authorId(id), authorDisplayName: names[id] ?? 'チャット参加者',
        text: id === 'rounded' ? '<img src=x onerror=alert(1)>' + '長い本文'.repeat(100) : `本文fixture ${id}`,
        type: 'textMessageEvent' });
      let queued = [...special, ...Array.from({ length: 45 }, (_, i) => `initial-${i}`)].map(message);
      Object.assign(globalThis, { monitorFixture: {
        append() { queued = [message(`new-${++batch}`)]; },
        appendMany(count: number) { queued = Array.from({ length: count }, () => message(`new-${++batch}`)); },
        hold() { held = new Promise<void>(resolve => { release = resolve; }); },
        release() { held = undefined; release(); },
        requests() { return requests; },
        hide() { hidden = [authorId('bad'), authorId('burst')]; },
      } });
      chrome.runtime.sendMessage = async request => {
        const value = request as { type: string; id: string; authorChannelId: string };
        if (value.type === 'youtube.status') return { ok: true, value: { videoId: 'abcdefghijk', credentialsAvailable: true } };
        if (value.type === 'youtube.resolve') return { ok: true, value: { liveChatId: 'fixture' } };
        if (value.type === 'youtube.list') {
          const messages = queued; queued = [];
          return { ok: true, value: { messages, nextPageToken: 'next', pollingIntervalMillis: 5000, ended: false } };
        }
        if (value.type === 'hidden.list') return { ok: true, videoId: 'abcdefghijk', ids: hidden,
          authors: hidden.map(authorChannelId => ({ authorChannelId, displayName: authorChannelId === authorId('bad') ? 'みどり' : 'りん' })) };
        if (value.type === 'hidden.remove') { hidden = hidden.filter(id => id !== value.authorChannelId); return { ok: true }; }
        if (value.type === 'jev.evaluate') {
          requests++; await held;
          if (value.id === 'missing') return { ok: false };
          const evaluated = ['zero', 'rounded', 'bad'].includes(value.id);
          const score = value.id === 'rounded' ? 0.799999 : value.id === 'bad' ? 0.8 : 0;
          return { ok: true, value: {
            id: value.id, authorChannelId: authorId(value.id),
            burst: value.id === 'burst' ? 'confirmed' : 'notObserved',
            jev: evaluated ? 'evaluated' : value.id === 'failed' ? 'failed' : value.id === 'burst' ? 'unjudged' : 'disabled',
            reasons: value.id === 'bad' ? ['attack'] : value.id === 'burst' ? ['burst'] : [],
            ...(evaluated || value.id === 'burst' ? { malicious: value.id === 'bad' || value.id === 'burst' } : {}),
            ...(evaluated ? { threshold: 0.8, evaluation: { values: Object.fromEntries(categories.map(key => [key, key === 'attack' ? score : 0])), model: 'fixture', usage: { input_tokens: 1, output_tokens: 1 } } } : {}),
            ...(value.id === 'failed' ? { error: { code: 'network' } } : {}),
          } };
        }
        return { ok: true };
      };
    }, [...keys]);
    await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/monitor.html`);
    await run(page);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
}

async function collect(page: Page) {
  await page.getByRole('button', { name: 'Jev判定を有効化・再開' }).click();
  await page.getByRole('button', { name: '取得を開始', exact: true }).click();
  await page.clock.runFor(5_100);
  await expect(page.locator('#messages > li')).toHaveCount(52);
}

test('monitor retention: 大量inputでも直近200件だけ表示し古い本文をDOMに残さない', async () => {
  await withMonitor(async page => {
    await collect(page);
    await page.evaluate(() => monitorFixture.appendMany(1000));
    await page.clock.runFor(5_100);
    await expect(page.locator('#messages > li')).toHaveCount(200);
    await expect(page.locator('#messages')).not.toContainText('本文fixture zero');
    await expect(page.locator('#messages > li').first()).toContainText('本文fixture new-801');
    await expect(page.locator('#messages > li').last()).toContainText('本文fixture new-1000');
  });
});

test('monitor retention: 遅い評価中も待ち行列はboundedでidle60秒に未判定へ解放', async () => {
  await withMonitor(async page => {
    await collect(page);
    const before = await page.evaluate(() => monitorFixture.requests());
    await page.evaluate(() => { monitorFixture.hold(); monitorFixture.appendMany(500); });
    await page.clock.runFor(5_100);
    await page.clock.runFor(60_001);
    await expect(page.locator('#messages > li').last()).toContainText('未判定：判定の待ち時間や表示件数の上限を超えました。');
    await page.evaluate(() => monitorFixture.release());
    await page.clock.runFor(100);
    expect(await page.evaluate(() => monitorFixture.requests()) - before).toBeLessThanOrEqual(1);
  });
});

test('monitor UI fixture: 密なコメント・最大スコア/raw・配信別一覧と空状態・安全な折返し', async () => {
  await withMonitor(async page => {
    const chat = page.getByRole('region', { name: '取得コメント', exact: true });
    await expect(chat).toBeVisible();
    await expect(page.getByText('コメントはまだありません。', { exact: true })).toBeVisible();
    await expect(page.getByText('この配信の非表示投稿者はいません。', { exact: true })).toBeVisible();
    await expect(page.locator('#hidden-authors li')).toHaveCount(0);
    await collect(page);
    await expect(page.getByText('コメントはまだありません。', { exact: true })).toBeHidden();
    const row = (id: string) => page.locator('#messages > li').filter({ has: page.locator('.chat-author', { hasText: authorId(id) }) });
    await expect(row('zero').locator('.score-badge')).toHaveText('判定スコア 0.00');
    await expect(row('rounded').locator('.score-badge')).toHaveText('判定スコア 0.80');
    await expect(row('rounded').locator('.chat-author .author-name')).toHaveText('はるか');
    await expect(row('rounded').locator('.author-details span')).toHaveText(authorId('rounded'));
    await expect(row('rounded').locator('.moderation-status')).toContainText('該当なし');
    await expect(row('rounded').locator('.moderation-status')).not.toContainText('悪質');
    await expect(row('bad').locator('.moderation-status')).toContainText('悪質');
    const details = row('rounded').locator('.score-details');
    await expect(details.locator('summary')).toHaveText('項目別スコア');
    await details.locator('summary').click();
    await expect(details.locator('dt')).toHaveCount(7);
    await expect(details.locator('dd').first()).toHaveText('0.799999');
    for (const id of ['disabled', 'burst', 'missing', 'failed']) {
      await expect(row(id).locator('.score-badge')).toHaveCount(0);
      await expect(row(id).locator('.score-details')).toHaveCount(0);
    }
    await expect(row('burst')).toContainText('10秒以内10件以上の連投');
    await expect(row('failed')).toContainText('判定失敗');
    await expect(row('missing')).toContainText('未判定');
    await expect(page.getByText(/判定スコアは7項目の最高値/)).toBeVisible();
    await expect(page.getByText(/正確さを保証する数値ではありません/)).toBeVisible();
    await expect(page.getByText('「項目別スコア」には丸め前の数値を表示し、判定にもこの数値を使います。', { exact: true })).toBeVisible();
    await expect(page.getByText(/未判定は「該当なし」ではありません/)).toBeVisible();
    await expect(page.getByText(/終了済み配信のチャット再生には対応していません/)).toBeVisible();
    await expect(page.locator('.hidden-author-panel .monitor-note li')).toHaveCount(3);
    await expect(row('rounded').locator('.chat-text')).toContainText('<img src=x onerror=alert(1)>');
    await expect(page.locator('#messages img, #messages script')).toHaveCount(0);
    await page.evaluate(() => monitorFixture.hide());
    await page.clock.runFor(1_100);
    await expect(page.locator('#hidden-authors li')).toHaveCount(2);
    await expect(page.locator('#hidden-authors')).not.toContainText(authorId('failed'));
    await page.getByRole('button', { name: `みどり（投稿者ID：${authorId('bad')}）の非表示を解除`, exact: true }).click();
    await expect(page.locator('#hidden-authors li')).toHaveCount(1);
    const layout = await page.evaluate(() => {
      const chat = document.querySelector<HTMLElement>('.chat-scroll')!;
      const hidden = document.querySelector('#hidden-authors')!.closest('section')!;
      return { scrollable: chat.scrollHeight > chat.clientHeight, overflowY: getComputedStyle(chat).overflowY,
        hiddenBelow: hidden.getBoundingClientRect().top >= chat.getBoundingClientRect().bottom,
        horizontalOverflow: chat.scrollWidth > chat.clientWidth };
    });
    expect(layout).toEqual({ scrollable: true, overflowY: 'auto', hiddenBelow: true, horizontalOverflow: false });
    await page.setViewportSize({ width: 480, height: 720 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#hidden-authors')).not.toContainText(authorId('missing'));
  });
});

test('monitor UI fixture: 過去閲覧中は新着でスクロールせず、底部のみ追随', async () => {
  await withMonitor(async page => {
    await collect(page);
    const chat = page.locator('.chat-scroll');
    await chat.evaluate(element => { element.scrollTop = 0; });
    await page.clock.runFor(20);
    await page.evaluate(() => monitorFixture.append());
    await page.clock.runFor(5_100);
    await expect(page.locator('#messages > li')).toHaveCount(53);
    expect(await chat.evaluate(element => element.scrollTop)).toBe(0);
    await chat.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.clock.runFor(20);
    await page.evaluate(() => monitorFixture.append());
    await page.clock.runFor(5_100);
    await expect(page.locator('#messages > li')).toHaveCount(54);
    expect(await chat.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(2);
  });
});
