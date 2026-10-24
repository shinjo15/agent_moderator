import { test, expect, chromium, type Page, type Worker } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { keys } from '../tests/fixtures/jev';

declare const chrome: { runtime: { sendMessage(message: unknown): Promise<unknown> } };
declare const monitorFixture: { append(): void; appendMany(count: number): void; hold(): void; release(): void; requests(): number; hide(ids?: string[]): void;
  holdHidden(): void; releaseHidden(): void; failHidden(value: boolean): void; avatars(): void; setTarget(video: string, pending?: boolean): void };
const authorId = (id: string) => `UC${id.padEnd(22, '_')}`;

// Assigned UI fixture results, not live API output or model accuracy measurements.
async function withMonitor(run: (page: Page, worker: Worker) => Promise<void>, locale = 'ja') {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-monitor-ui-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, locale,
    env: { ...process.env, LANGUAGE: locale, LANG: `${locale}_${locale.toUpperCase()}.UTF-8` },
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
      let video = 'abcdefghijk'; let targetPending = false;
      let hidden: string[] = [];
      let hiddenHeld: Promise<void> | undefined; let releaseHidden = () => {}; let hiddenFailure = false;
      const special = ['zero', 'rounded', 'bad', 'disabled', 'burst', 'missing', 'failed'];
      const authorId = (id: string) => `UC${id.padEnd(22, '_')}`;
      const names: Record<string, string> = { zero: 'あおい', rounded: 'はるか', bad: 'みどり', disabled: 'さくら', burst: 'りん', missing: 'なお', failed: 'ゆう' };
      let avatars = false;
      const message = (id: string) => ({ id, authorChannelId: authorId(id), authorDisplayName: names[id] ?? 'チャット参加者',
        ...(avatars ? { authorProfileImageUrl: id === 'missing' ? 'https://yt3.ggpht.com.evil.invalid/avatar' : `https://${id === 'rounded' ? 'yt3.googleusercontent.com' : 'yt3.ggpht.com'}/${id}` } : {}),
        text: id === 'rounded' ? '<img src=x onerror=alert(1)>' + '長い本文'.repeat(100) : `本文fixture ${id}`,
        type: 'textMessageEvent' });
      let queued = [...special, ...Array.from({ length: 45 }, (_, i) => `initial-${i}`)].map(message);
      Object.assign(globalThis, { monitorFixture: {
        setTarget(value: string, pending = false) { video = value; targetPending = pending; },
        avatars() { avatars = true; queued = queued.map(post => ({ ...message(post.id), authorDisplayName: `${'さくら Sakura'.repeat(20)} ${post.id}`, text: '配信を楽しみにしています Thank you for the stream! '.repeat(40) })); },
        append() { queued = [message(`new-${++batch}`)]; },
        appendMany(count: number) { queued = Array.from({ length: count }, () => message(`new-${++batch}`)); },
        hold() { held = new Promise<void>(resolve => { release = resolve; }); },
        release() { held = undefined; release(); },
        requests() { return requests; },
        hide(ids = ['bad', 'burst']) { hidden = ids.map(authorId); },
        holdHidden() { hiddenHeld = new Promise<void>(done => { releaseHidden = done; }); },
        releaseHidden() { hiddenHeld = undefined; releaseHidden(); },
        failHidden(value: boolean) { hiddenFailure = value; },
      } });
      chrome.runtime.sendMessage = async request => {
        const value = request as { type: string; id: string; authorChannelId: string };
        if (value.type === 'youtube.status') return targetPending ? { ok: false, error: { code: 'aborted', targetChanged: true } }
          : { ok: true, value: { videoId: video, credentialsAvailable: true } };
        if (value.type === 'youtube.resolve') return { ok: true, value: { liveChatId: 'fixture' } };
        if (value.type === 'youtube.list') {
          const messages = queued; queued = [];
          return { ok: true, value: { messages, nextPageToken: 'next', pollingIntervalMillis: 5000, ended: false } };
        }
        if (value.type === 'hidden.list') {
          const result = { ok: true, videoId: video, ids: hidden,
            authors: hidden.map(authorChannelId => ({ authorChannelId, displayName: names[authorChannelId.slice(2).replace(/_+$/, '')] ?? 'チャット参加者' })) };
          await hiddenHeld; if (hiddenFailure) throw new Error('synthetic-storage-failure'); return result;
        }
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
    await run(page, worker);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
}

test('切替通知後のstatusが次のnavで保留されてもStopを維持し最終対象へ自動追従する', async () => {
  await withMonitor(async (page, worker) => {
    await page.getByRole('button', { name: '取得を開始', exact: true }).click();
    await page.clock.runFor(5100);
    await page.evaluate(() => monitorFixture.setTarget('zyxwvutsrqp', true));
    await worker.evaluate(() => chrome.runtime.sendMessage({ type: 'youtube.targetChanged' }));
    await expect(page.getByRole('button', { name: '取得を停止', exact: true })).toBeEnabled();
    await page.evaluate(() => monitorFixture.setTarget('finalvideo1'));
    await worker.evaluate(() => chrome.runtime.sendMessage({ type: 'youtube.targetChanged' }));
    await expect(page.locator('.viewer-header')).toContainText('finalvideo1');
    await expect(page.getByRole('button', { name: '取得を停止', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '取得を停止', exact: true }).click();
    await page.clock.runFor(30000);
    await expect(page.getByRole('button', { name: '取得を開始', exact: true })).toBeEnabled();
  });
});

async function collect(page: Page) {
  await page.getByRole('button', { name: 'Jev判定を有効化・再開' }).click();
  await page.getByRole('button', { name: '取得を開始', exact: true }).click();
  await page.clock.runFor(5_100);
  await expect(page.locator('#messages > li')).toHaveCount(52);
}

for (const locale of ['ja', 'en']) test(`MV3 avatar ${locale}: admission後だけ通信・解除/失敗代替・固定寸法/過去位置/狭幅`, async () => {
  await withMonitor(async page => {
    const requests: string[] = [];
    let release!: () => void;
    const held = new Promise<void>(done => { release = done; });
    await page.context().route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.protocol !== 'https:') return route.continue();
      requests.push(route.request().url());
      expect(['yt3.ggpht.com', 'yt3.googleusercontent.com']).toContain(url.hostname);
      expect(route.request().headers()['referer']).toBeUndefined();
      expect(route.request().headers()['cookie']).toBeUndefined();
      expect(url.search).toBe('');
      await held;
      if (url.pathname === '/failed') return route.abort();
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#628a73"/></svg>' });
    });
    await page.evaluate(() => { monitorFixture.avatars(); monitorFixture.hide(['bad']); monitorFixture.holdHidden(); });
    await page.getByRole('button', { name: locale === 'ja' ? '取得を開始' : 'Start collection', exact: true }).click();
    await page.clock.runFor(5100);
    await expect(page.locator('#messages > li')).toHaveCount(0);
    expect(requests).toEqual([]);
    await page.evaluate(() => monitorFixture.releaseHidden()); await page.clock.runFor(30);
    await expect(page.locator('#messages > li')).toHaveCount(51);
    await expect.poll(() => requests.length).toBe(50);
    expect(requests.some(url => url.endsWith('/bad'))).toBe(false);
    const chat = page.locator('.chat-scroll');
    await chat.evaluate(element => { element.scrollTop = 0; }); await page.clock.runFor(20);
    const before = await page.locator('#messages > li').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
    release();
    await expect.poll(() => page.locator('#messages img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete))).toBe(true);
    await expect(page.locator('#messages img')).toHaveCount(49);
    expect(await page.locator('#messages > li').evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height))).toEqual(before);
    expect(await chat.evaluate(element => element.scrollTop)).toBe(0);
    const failed = page.locator('#messages > li').filter({ has: page.locator('.author-name', { hasText: / failed$/ }) });
    await expect(failed.locator('.chat-avatar')).toBeVisible(); await expect(failed.locator('img')).toHaveCount(0);
    await expect(page.locator('#messages .chat-avatar')).toHaveCount(51);
    for (const width of [360, 400, 480, 576, 1000]) {
      await page.setViewportSize({ width, height: 800 });
      for (const selector of ['.chat-text', '.chat-author']) {
        expect(await page.locator(selector).first().evaluate(element => {
          const style = getComputedStyle(element);
          return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight };
        })).toEqual({ family: 'Roboto, Arial, sans-serif', size: '13px', weight: '400' });
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await chat.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await page.locator('.chat-avatar').evaluateAll(elements => elements.every(element => {
        const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
        return rect.width === 24 && rect.height === 24 && style.borderRadius === '50%';
      }))).toBe(true);
      expect(await page.locator('#messages > li').evaluateAll(rows => rows.every(row => {
        const content = row.querySelector('.chat-content')!.getBoundingClientRect();
        const avatar = row.querySelector('.chat-avatar')!.getBoundingClientRect();
        const badge = row.querySelector('.score-badge')!.getBoundingClientRect();
        const more = row.querySelector('.message-details > summary')!.getBoundingClientRect();
        return content.right < badge.left && avatar.right <= content.right && badge.right <= more.left
          && badge.top === content.top && badge.height <= 24 && badge.width <= 56;
      }))).toBe(true);
      await page.locator('.score-badge').first().hover();
      expect(await page.locator('.score-badge').first().evaluate(element => {
        const style = getComputedStyle(element);
        return { background: style.backgroundColor, border: style.borderTopWidth, radius: style.borderRadius, color: style.color, borderColor: style.borderTopColor };
      })).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '1px', radius: '5px', color: 'rgb(21, 128, 61)', borderColor: 'rgb(21, 128, 61)' });
      const neutral = page.locator('.score-badge[data-state="neutral"]').first();
      await neutral.hover();
      await expect(neutral).toHaveCSS('color', 'rgb(100, 116, 139)');
      await expect(neutral).toHaveCSS('border-top-color', 'rgb(100, 116, 139)');
      await expect(neutral).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
    expect(await page.locator('#messages img').evaluateAll(images => images.every(node => {
      const image = node as HTMLImageElement;
      return image.complete && image.naturalWidth === 48 && image.alt === '' && image.referrerPolicy === 'no-referrer'
        && getComputedStyle(image).objectFit === 'cover' && image.getBoundingClientRect().width === 24;
    }))).toBe(true);
    await page.getByRole('button', { name: locale === 'ja' ? '非表示一覧' : 'Hidden authors', exact: true }).click();
    await page.locator('#hidden-authors button').click();
    await expect.poll(() => requests.filter(url => url.endsWith('/bad')).length).toBe(1);
    await expect(page.locator('#messages > li')).toHaveCount(52); await page.keyboard.press('Escape');
    await expect.poll(() => page.locator('#messages > li').filter({ has: page.locator('.author-name', { hasText: / bad$/ }) })
      .locator('img').evaluate(node => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth === 48)).toBe(true);
    const previous = requests.length;
    await page.evaluate(() => { monitorFixture.holdHidden(); monitorFixture.appendMany(1000); }); await page.clock.runFor(5100);
    expect(requests.length).toBe(previous);
    await page.evaluate(() => monitorFixture.releaseHidden()); await page.clock.runFor(30);
    await expect(page.locator('#messages > li')).toHaveCount(200);
    await expect.poll(() => requests.length).toBe(previous + 200);
    expect(requests.some(url => /\/new-([1-7]?\d?\d|800)$/.test(url))).toBe(false);
  }, locale);
});

test('monitor retention: 大量inputでも直近200件だけ表示し古い本文をDOMに残さない', async () => {
  await withMonitor(async page => {
    await collect(page);
    await page.evaluate(() => monitorFixture.appendMany(1000));
    await page.evaluate(() => monitorFixture.hide(['new-999', 'new-1000']));
    await page.clock.runFor(5_100);
    await expect(page.locator('#messages > li')).toHaveCount(198);
    await expect(page.locator('#messages')).not.toContainText('本文fixture zero');
    await expect(page.locator('#messages > li').first()).toContainText('本文fixture new-801');
    await expect(page.locator('#messages > li').last()).toContainText('本文fixture new-998');
    await page.getByRole('button', { name: '非表示一覧', exact: true }).click();
    for (const id of ['new-999', 'new-1000']) await page.getByRole('button', { name: `チャット参加者（投稿者ID：${authorId(id)}）の非表示を解除`, exact: true }).click();
    await expect(page.locator('#messages > li')).toHaveCount(200);
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
    await expect(page.locator('#messages > li').last().locator('.evaluation-summary')).toHaveAccessibleName(/未判定（上限）/);
    await expect(page.locator('#messages > li').last().locator('.evaluation-summary')).toBeVisible();
    await page.evaluate(() => monitorFixture.release());
    await page.clock.runFor(100);
    expect(await page.evaluate(() => monitorFixture.requests()) - before).toBeLessThanOrEqual(1);
  });
});
test('viewer同期: 保存読取待ちの新着だけ保留・読取失敗は漏らさず再試行・対象切替で旧本文を破棄', async () => {
  await withMonitor(async page => {
    await collect(page);
    await page.evaluate(() => { monitorFixture.holdHidden(); monitorFixture.hide(['new-1']); monitorFixture.append(); });
    await page.clock.runFor(5100);
    await expect(page.locator('#messages > li')).toHaveCount(52);
    await expect(page.locator('#messages')).not.toContainText('本文fixture new-1');
    await page.clock.runFor(100); // Render frames while the storage read is deliberately delayed.
    await expect(page.locator('#messages > li')).toHaveCount(52);
    await page.evaluate(() => monitorFixture.releaseHidden()); await page.clock.runFor(20);
    await expect(page.locator('#messages > li')).toHaveCount(52);
    await expect(page.locator('#hidden-authors li')).toHaveCount(1);
    await page.evaluate(() => { monitorFixture.failHidden(true); monitorFixture.append(); }); await page.clock.runFor(5100);
    await expect(page.locator('#messages li')).toHaveCount(0);
    await expect(page.locator('.chat-scroll')).toContainText('コメント表示を保留');
    await page.getByRole('button', { name: '非表示一覧', exact: true }).click();
    await expect(page.getByRole('button', { name: '非表示リストを再試行', exact: true })).toBeVisible();
    await page.evaluate(() => monitorFixture.failHidden(false));
    await page.getByRole('button', { name: '非表示リストを再試行', exact: true }).click();
    await expect(page.locator('#messages li')).toHaveCount(53);
    await expect(page.locator('#messages')).not.toContainText('本文fixture new-1');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { monitorFixture.holdHidden(); monitorFixture.append(); }); await page.clock.runFor(5100);
    await page.context().serviceWorkers()[0].evaluate(() => chrome.runtime.sendMessage({ type: 'youtube.targetChanged' }));
    await page.evaluate(() => monitorFixture.releaseHidden()); await page.clock.runFor(20);
    await expect(page.locator('#messages li')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '取得を開始', exact: true })).toBeDisabled();
    await page.reload(); await expect(page.locator('#messages li')).toHaveCount(0);
  });
});

test('monitor UI fixture: 密なコメント・最大スコア/raw・配信別一覧と空状態・安全な折返し', async () => {
  await withMonitor(async page => {
    const chat = page.getByRole('region', { name: '取得コメント', exact: true });
    await expect(chat).toBeVisible();
    await expect(page.getByText('コメントはまだありません。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '非表示一覧', exact: true }).click();
    await expect(page.getByText('この配信者の非表示投稿者はいません。', { exact: true })).toBeVisible();
    await expect(page.locator('#hidden-authors li')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await collect(page);
    await expect(page.getByText('コメントはまだありません。', { exact: true })).toBeHidden();
    const row = (id: string) => page.locator('#messages > li').filter({ has: page.locator('.author-details', { hasText: authorId(id) }) });
    await expect(row('zero').locator('.score-badge')).toHaveText('✓ 0.00');
    await expect(row('zero').locator('.score-badge')).toHaveAttribute('data-state', 'good');
    await expect(row('zero').locator('.score-badge')).toHaveAccessibleName(/該当なし.*判定スコア 0.00/);
    await expect(row('zero').locator('.message-details')).not.toHaveAttribute('open');
    await expect(row('zero').locator('.score-badge')).toBeVisible();
    await expect(row('zero').locator('.score-badge')).toHaveAttribute('title', /判定済み/);
    expect(await row('zero').locator('.score-badge').evaluate(element => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, color: style.color, border: style.borderTopWidth, borderColor: style.borderTopColor };
    })).toEqual({ background: 'rgba(0, 0, 0, 0)', color: 'rgb(21, 128, 61)', border: '1px', borderColor: 'rgb(21, 128, 61)' });
    await expect(row('rounded').locator('.score-badge')).toHaveText('✓ 0.80');
    await expect(row('rounded').locator('.score-badge')).toHaveAttribute('data-state', 'good');
    await expect(row('bad').locator('.score-badge')).toHaveText('× 0.80');
    await expect(row('bad').locator('.score-badge')).toHaveAttribute('data-state', 'bad');
    await expect(row('rounded').locator('.score-badge')).toBeVisible();
    await expect(row('rounded').locator('.chat-author .author-name')).toHaveText('はるか');
    await expect(row('rounded').locator('.author-details span')).toHaveText(authorId('rounded'));
    await expect(row('rounded').locator('.moderation-status')).toContainText('該当なし');
    await expect(row('rounded').locator('.moderation-status')).not.toContainText('悪質');
    await expect(row('bad').locator('.moderation-status')).toContainText('悪質');
    const details = row('rounded').locator('.score-details');
    await expect(details.locator('summary')).toHaveText('項目別スコア');
    await row('rounded').locator('.message-details > summary').focus();
    await page.keyboard.press('Enter');
    await expect(row('rounded').locator('.message-details')).toHaveAttribute('open', '');
    await details.locator('summary').click();
    await expect(details.locator('dt')).toHaveCount(7);
    await expect(details.locator('dd').first()).toHaveText('0.799999');
    for (const id of ['disabled', 'burst', 'missing', 'failed']) {
      await expect(row(id).locator('.score-badge')).toHaveText(id === 'burst' ? '× —' : id === 'failed' ? '!' : '—');
      await expect(row(id).locator('.score-badge')).toHaveAttribute('data-state', id === 'burst' ? 'bad' : 'neutral');
      await expect(row(id).locator('.score-details')).toHaveCount(0);
      await expect(row(id).locator('.evaluation-summary')).toBeVisible();
    }
    await expect(row('disabled').locator('.score-badge')).toHaveAccessibleName(/未判定.*Jev判定は未開始・停止中/);
    await expect(row('burst').locator('.score-badge')).toHaveAccessibleName(/連投・AI未判定.*悪質/);
    await expect(row('failed').locator('.score-badge')).toHaveAccessibleName(/判定失敗/);
    await expect(row('burst')).toContainText('10秒以内10件以上の連投');
    await expect(row('failed')).toContainText('判定失敗');
    await expect(row('missing')).toContainText('未判定');
    await page.getByRole('button', { name: '利用と判定について', exact: true }).click();
    await expect(page.getByText(/判定スコアは7項目の最高値/)).toBeVisible();
    await expect(page.getByText(/正確さを保証する数値ではありません/)).toBeVisible();
    await expect(page.getByText('「項目別スコア」には丸め前の数値を表示し、判定にもこの数値を使います。', { exact: true })).toBeVisible();
    await expect(page.getByText(/未判定は「該当なし」ではありません/)).toBeVisible();
    await expect(page.getByText(/終了済み配信のチャット再生には対応していません/)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.hidden-author-panel .monitor-note li')).toHaveCount(3);
    await expect(row('rounded').locator('.chat-text')).toContainText('<img src=x onerror=alert(1)>');
    await expect(page.locator('#messages img, #messages script')).toHaveCount(0);
    await page.evaluate(() => monitorFixture.hide());
    await page.clock.runFor(1_100);
    await expect(page.locator('#hidden-authors li')).toHaveCount(2);
    await expect(page.locator('#hidden-authors')).not.toContainText(authorId('failed'));
    await expect(row('bad')).toHaveCount(0); await expect(row('burst')).toHaveCount(0);
    await expect(page.locator('#messages .score-badge')).toHaveCount(50);
    await expect(page.locator('#messages .score-badge[data-state="bad"]')).toHaveCount(0);
    await page.getByRole('button', { name: '非表示一覧', exact: true }).click();
    await page.getByRole('button', { name: `みどり（投稿者ID：${authorId('bad')}）の非表示を解除`, exact: true }).click();
    await expect(page.locator('#hidden-authors li')).toHaveCount(1);
    await expect(row('bad')).toContainText('悪質');
    await expect(row('bad').locator('.score-badge')).toBeVisible();
    await page.keyboard.press('Escape');
    const layout = await page.evaluate(() => {
      const chat = document.querySelector<HTMLElement>('.chat-scroll')!;
      const hidden = document.querySelector<HTMLDialogElement>('.hidden-dialog')!;
      return { scrollable: chat.scrollHeight > chat.clientHeight, overflowY: getComputedStyle(chat).overflowY,
        hiddenOutsideReader: !hidden.open && !chat.contains(hidden),
        horizontalOverflow: chat.scrollWidth > chat.clientWidth };
    });
    expect(layout).toEqual({ scrollable: true, overflowY: 'auto', hiddenOutsideReader: true, horizontalOverflow: false });
    await page.setViewportSize({ width: 480, height: 720 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#hidden-authors')).not.toContainText(authorId('missing'));
  });
});

test('monitor UI fixture: 過去閲覧中は新着でスクロールせず、底部のみ追随', async () => {
  await withMonitor(async page => {
    await collect(page);
    const chat = page.locator('.chat-scroll');
    // A storage snapshot can finish before the browser dispatches the queued
    // scroll event. Exercise that order, not a timing-dependent 20ms grace.
    await page.evaluate(() => monitorFixture.holdHidden());
    await page.clock.runFor(1000);
    await chat.evaluate(element => {
      element.scrollTop = 0;
      monitorFixture.releaseHidden();
    });
    await page.clock.runFor(20);
    await page.evaluate(() => monitorFixture.append());
    await page.clock.runFor(5_100);
    await expect(page.locator('#messages > li')).toHaveCount(53);
    expect(await chat.evaluate(element => element.scrollTop)).toBe(0);
    await expect(page.getByRole('button', { name: '↓ 最新へ戻る', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '↓ 最新へ戻る', exact: true }).click();
    await page.clock.runFor(20);
    await page.evaluate(() => monitorFixture.append());
    await page.clock.runFor(5_100);
    await expect(page.locator('#messages > li')).toHaveCount(54);
    expect(await chat.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(2);
    await chat.evaluate(element => { element.scrollTop = 900; }); await page.clock.runFor(20);
    const anchor = () => page.evaluate(() => {
      const chat = document.querySelector('.chat-scroll')!; const top = chat.getBoundingClientRect().top;
      const row = [...chat.querySelectorAll('li')].find(row => row.getBoundingClientRect().bottom > top)!;
      return { text: row.querySelector('.chat-text')!.textContent, offset: row.getBoundingClientRect().top - top };
    });
    const before = await anchor();
    await page.evaluate(() => monitorFixture.hide()); await page.clock.runFor(1100);
    const after = await anchor(); expect(after.text).toBe(before.text);
    expect(Math.abs(after.offset - before.offset)).toBeLessThanOrEqual(1);
    await page.locator('#messages > li').first().locator('.message-details').evaluate(element => { (element as HTMLDetailsElement).open = true; });
    await page.clock.runFor(30);
    const resized = await anchor(); expect(resized.text).toBe(after.text);
    expect(Math.abs(resized.offset - after.offset)).toBeLessThanOrEqual(1);
    await page.locator('#messages > li').last().locator('.message-details > summary').focus();
    const selection = await page.locator('#messages > li').last().locator('.chat-text').evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      getSelection()!.removeAllRanges(); getSelection()!.addRange(range); return getSelection()!.toString();
    });
    await page.clock.runFor(2100);
    await expect(page.locator('#messages > li').last().locator('.message-details > summary')).toBeFocused();
    expect(await page.evaluate(() => getSelection()!.toString())).toBe(selection);
    // Also exercise a real browser wheel event; compositor scrolling is not
    // advanced by page.clock, so observe its completion rather than sleeping.
    await chat.hover();
    await page.mouse.wheel(0, -10000);
    await expect.poll(() => chat.evaluate(element => element.scrollTop)).toBe(0);
    await page.evaluate(() => monitorFixture.append()); await page.clock.runFor(5100);
    expect(await chat.evaluate(element => element.scrollTop)).toBe(0);
  });
});
test('viewer C: 縦長360/400/480/576と通常幅でチャット主役・操作がviewport内、詳細と一覧は必要時だけ', async () => {
  await withMonitor(async page => {
    await collect(page);
    for (const width of [360, 400, 480, 576, 1000]) {
      await page.setViewportSize({ width, height: 800 });
      const geometry = await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('.chat-scroll')!;
        const chat = element.getBoundingClientRect();
        const controls = document.querySelector('.monitor-controls')!.getBoundingClientRect();
        return { overflow: document.documentElement.scrollWidth > innerWidth, pageOverflow: document.documentElement.scrollHeight > innerHeight,
          chatOverflow: element.scrollWidth > element.clientWidth, chatHeight: chat.height, controlsBottom: controls.bottom, controlsTop: controls.top, chatBottom: chat.bottom };
      });
      expect(geometry.overflow).toBe(false); expect(geometry.pageOverflow).toBe(false);
      expect(geometry.chatOverflow).toBe(false);
      expect(geometry.chatHeight).toBeGreaterThan(400); expect(geometry.controlsBottom).toBeLessThanOrEqual(800);
      expect(geometry.chatBottom).toBeLessThanOrEqual(geometry.controlsTop);
      expect(await page.locator('.chat-message').evaluateAll(elements =>
        elements.every(element => getComputedStyle(element).borderBottomStyle === 'none'))).toBe(true);
    }
    await expect(page.locator('.score-badge').first()).toBeVisible();
    await expect(page.locator('.message-details').first()).not.toHaveAttribute('open');
    await expect(page.locator('.score-details').first()).toBeHidden();
    await page.getByRole('button', { name: '非表示一覧', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toBeHidden();
    await page.getByRole('button', { name: '設定を開く', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.frameLocator('iframe').getByRole('heading', { name: 'Agent Moderator 設定' })).toBeVisible();
    await page.frameLocator('iframe').locator('html').evaluate(element => { element.style.scrollbarGutter = 'stable'; });
    for (const width of [360, 400, 480, 576]) {
      await page.setViewportSize({ width, height: 800 });
      const internal = await page.frameLocator('iframe').locator('body').evaluate(() => ({
        width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth,
        outside: [...document.querySelectorAll<HTMLElement>('input, select, button')].filter(element => element.getClientRects().length)
          .filter(element => element.getBoundingClientRect().left < 0 || element.getBoundingClientRect().right > document.documentElement.clientWidth).map(element => element.tagName),
      }));
      expect(internal.scrollWidth).toBeLessThanOrEqual(internal.width); expect(internal.outside).toEqual([]);
    }
  });
});
