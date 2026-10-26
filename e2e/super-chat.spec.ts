import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { apiResponse } from '../tests/fixtures/jev';

declare const chrome: { runtime: { sendMessage(m: unknown): Promise<unknown> }; tabs: { create(o: { url: string; active: boolean }): Promise<unknown> }; storage: { local: { get(keys: string[] | null): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void> } } };
const video = 'abcdefghijk';
const channel = 'UC0000000000000000000000';
const author = (n: number) => `UC${String(n).padStart(22, '0')}`;
const longName = '<img src=x onerror=alert(1)> LongName' + '長名WithoutSpaces'.repeat(15);
const longAmount = 'US$1,234,567,890,123.45';

for (const locale of ['ja', 'en']) test(`実MV3 Super Chat ${locale}: 公式形式fixture→runtime→承認カード/非表示/本文のみJev`, async () => {
  test.setTimeout(90000);
  const profile = await mkdtemp(join(tmpdir(), 'moderator-super-chat-'));
  const extension = resolve('dist');
  const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, locale,
    env: { ...process.env, LANGUAGE: locale, LANG: `${locale}_${locale.toUpperCase()}.UTF-8` },
    args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const ja = locale === 'ja';
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    const storageKey = `hiddenAuthors.channel.${channel}`;
    await worker.evaluate(({ storageKey, hidden }) => chrome.storage.local.set({ [storageKey]: { ids: [hidden], revisions: {} } }), { storageKey, hidden: author(12) });
    const requests: string[] = []; const images: string[] = []; const states: { target: { text: string }; history: unknown[] }[] = [];
    const body = (n: number) => n === 1 ? '' : `本文 / Comment ${n}\n<img src=x onerror=alert(1)> ${'longWord'.repeat(20)}`;
    const paid = (n: number, details: unknown) => ({ id: `paid-${n}`, authorDetails: { channelId: author(n), displayName: n === 5 ? longName : `Author ${n}`,
      profileImageUrl: `https://yt3.ggpht.com/paid-${n}` }, snippet: { type: 'superChatEvent', hasDisplayContent: true,
      displayMessage: `PAYMENT DESCRIPTION ${n}`, publishedAt: '2026-01-01T00:00:00Z', superChatDetails: details } });
    const fixtures = [
      { id: 'normal', authorDetails: { channelId: author(20), displayName: '通常 / Normal' }, snippet: { type: 'textMessageEvent', hasDisplayContent: true, displayMessage: '通常コメント', publishedAt: '2026-01-01T00:00:00Z' } },
      ...Array.from({ length: 7 }, (_, i) => paid(i + 1, { amountDisplayString: i === 4 ? longAmount : i % 2 ? '$5.00' : '￥1,000', currency: i % 2 ? 'USD' : 'JPY', amountMicros: '1000000000', tier: i + 1, userComment: body(i + 1) })),
      paid(9, { amountDisplayString: '€12.34', tier: 99, userComment: body(9) }),
      paid(10, { amountDisplayString: 100, tier: '7', userComment: null }),
      paid(11, undefined),
      paid(12, { amountDisplayString: '￥50,000', tier: 7, userComment: 'HIDDEN PAID BODY' }),
      paid(13, { amountDisplayString: '￥100', tier: 1, userComment: body(13) }),
    ];
    await context.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<main id="original">YouTube fixture</main>' }));
    await context.route('https://yt3.ggpht.com/**', route => {
      images.push(route.request().url());
      expect(route.request().headers()['referer']).toBeUndefined();
      return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"/>' });
    });
    await context.route('https://www.googleapis.com/youtube/v3/**', route => {
      const url = new URL(route.request().url()); requests.push(url.pathname);
      if (url.pathname.endsWith('/videos')) return route.fulfill({ json: { items: [{ id: video, snippet: { channelId: channel }, liveStreamingDetails: { activeLiveChatId: 'fixture' } }] } });
      expect(url.pathname).toBe('/youtube/v3/liveChat/messages'); expect(url.searchParams.get('part')).toBe('id,snippet,authorDetails');
      return route.fulfill({ json: { nextPageToken: 'next', pollingIntervalMillis: 60000, items: fixtures } });
    });
    await context.route('https://api.typesafe.ai/v1/systemone', route => {
      const state = route.request().postDataJSON().state; states.push(state);
      expect(JSON.stringify(state)).not.toMatch(/PAYMENT DESCRIPTION|amountDisplayString|tier|currency|amountMicros|superChat/);
      return route.fulfill({ json: apiResponse({ attack: state.target.text === body(7) ? 0.9 : 0.1 }) });
    });
    const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
    await options.getByRole('checkbox').check();
    await options.getByRole('button', { name: ja ? '同意を保存' : 'Save agreement', exact: true }).click();
    await expect(options.getByTestId('confirmation-status')).toContainText(ja ? '同意済み' : 'Agreed');
    for (const provider of ['YouTube', 'Jev']) {
      await options.getByLabel(ja ? `${provider} APIキー` : `${provider} API key`, { exact: true }).fill(`synthetic-${provider}`);
      await options.getByRole('button', { name: ja ? `${provider}キーを保存` : `Save ${provider} key`, exact: true }).click();
      await expect(options.getByLabel(ja ? `${provider} APIキー` : `${provider} API key`, { exact: true })).toHaveValue('');
    }
    const watch = await context.newPage(); await watch.goto(`https://www.youtube.com/watch?v=${video}`); await watch.bringToFront();
    const cdp = await context.browser()!.newBrowserCDPSession();
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
    await cdp.send('Extensions.triggerAction', { id, targetId: targetInfos.find(t => t.type === 'tab' && t.url === watch.url())!.targetId });
    const pp = context.waitForEvent('page');
    await worker.evaluate(id => chrome.tabs.create({ url: `chrome-extension://${id}/popup.html`, active: false }), id);
    const popup = await pp; const mp = context.waitForEvent('page');
    await popup.getByRole('button', { name: ja ? 'この動画のチャットを取得' : 'Collect chat for this video', exact: true }).click();
    const monitor = await mp;
    await monitor.getByRole('button', { name: ja ? 'Jev判定を有効化・再開' : 'Enable / resume Jev evaluation', exact: true }).click();
    await expect(monitor.getByTestId('jev-status')).toContainText(ja ? '有効' : 'enabled');
    await monitor.getByRole('button', { name: ja ? '取得を開始' : 'Start collection', exact: true }).click();
    await expect(monitor.locator('#messages > li')).toHaveCount(11, { timeout: 15000 });
    await expect(monitor.locator('#messages .paid-card')).toHaveCount(10);
    await expect(monitor.getByRole('group', { name: ja ? 'スーパーチャット' : 'Super Chat', exact: true })).toHaveCount(10);
    await expect.poll(() => states.length).toBe(10);
    await expect(monitor.locator('#messages')).not.toContainText('PAYMENT DESCRIPTION');
    await expect(monitor.locator('#messages')).not.toContainText('HIDDEN PAID BODY');
    expect(images).not.toContain('https://yt3.ggpht.com/paid-12');
    const empty = monitor.locator('.paid').filter({ has: monitor.locator('.author-name', { hasText: /^Author 1$/ }) });
    await expect(empty.locator('.paid-body')).toHaveCount(0);
    await expect(empty.locator('.score-badge')).toHaveText('—');
    await expect(empty.locator('.score-badge')).toHaveAttribute('data-state', 'neutral');
    await expect(monitor.locator('.paid-amount', { hasText: longAmount })).toHaveText(longAmount);
    await expect(monitor.locator('.paid[data-tier="unknown"]')).toHaveCount(3);
    const colors = ['rgb(21, 101, 192)', 'rgb(0, 184, 212)', 'rgb(0, 191, 165)', 'rgb(255, 202, 40)', 'rgb(255, 145, 0)', 'rgb(231, 80, 160)'];
    for (let i = 0; i < colors.length; i++) {
      for (const header of await monitor.locator(`.paid[data-tier="${i + 1}"] .paid-header`).all()) await expect(header).toHaveCSS('background-color', colors[i]);
    }
    await expect(monitor.locator('.paid[data-tier="unknown"] .paid-header').first()).toHaveCSS('background-color', 'rgb(220, 226, 233)');
    await expect.soft(monitor.locator('.paid[data-tier="1"] .paid-body')).toHaveCSS('color', 'rgb(255, 255, 255)');
    const expectUnifiedCards = async () => {
      const cards = await monitor.locator('.paid-card').evaluateAll(cards => cards.map(card => {
        const header = card.querySelector('.paid-header')!;
        const body = card.querySelector('.paid-body');
        const c = card.getBoundingClientRect(); const h = header.getBoundingClientRect();
        const b = body?.getBoundingClientRect();
        return {
          backgrounds: [card, header, ...(body ? [body] : [])].map(element => getComputedStyle(element).backgroundColor),
          headerBackground: getComputedStyle(header).backgroundColor,
          joined: { headerTop: h.top, headerLeft: h.left, headerWidth: h.width,
            bodyTop: b?.top, bodyLeft: b?.left, bodyWidth: b?.width, bodyBottom: b?.bottom },
          expected: { headerTop: c.top, headerLeft: c.left, headerWidth: c.width,
            bodyTop: b ? h.bottom : undefined, bodyLeft: b ? c.left : undefined,
            bodyWidth: b ? c.width : undefined, bodyBottom: b ? c.bottom : undefined },
        };
      }));
      for (const card of cards) {
        expect.soft(card.backgrounds).toEqual(card.backgrounds.map(() => card.headerBackground));
        expect.soft(card.joined).toEqual(card.expected);
      }
    };
    await expect(monitor.locator('#messages script, #messages img[src="x"]')).toHaveCount(0);
    for (const width of [360, 400, 480]) {
      await monitor.setViewportSize({ width, height: 800 });
      await expectUnifiedCards();
      expect(await monitor.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await monitor.locator('.paid').evaluateAll(rows => rows.every(row => {
        const head = row.querySelector('.paid-header')!; const identity = row.querySelector('.paid-identity')!;
        const badge = row.querySelector('.score-badge')!; const more = row.querySelector('.message-details > summary')!;
        const b = badge.getBoundingClientRect(); const i = identity.getBoundingClientRect();
        const style = getComputedStyle(badge);
        return head.scrollWidth <= head.clientWidth && i.right < b.left && b.width === 56 && b.right <= more.getBoundingClientRect().left
          && style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.borderTopWidth === '1px';
      }))).toBe(true);
      await expect(monitor.locator('#messages > li:not(.paid) .chat-content')).toHaveCSS('font-size', '13px');
    }
    const stored = await worker.evaluate(async key => (await chrome.storage.local.get([key]))[key], storageKey);
    expect(stored).toMatchObject({ triggerComments: { [author(7)]: { text: body(7), videoId: video } } });
    expect(JSON.stringify(stored)).not.toMatch(/amountDisplayString|PAYMENT DESCRIPTION|amountMicros|superChat/);
    await monitor.getByRole('button', { name: ja ? '非表示一覧' : 'Hidden authors', exact: true }).click();
    await monitor.locator('#hidden-authors li').filter({ hasText: 'Author 7' }).getByRole('button').click();
    await expect(monitor.locator('.paid[data-tier="7"]')).toHaveCount(1);
    await monitor.keyboard.press('Escape');
    await expect(monitor.locator('.paid[data-tier="7"] .score-badge')).toHaveText('× 0.90');
    await expect(monitor.locator('.paid[data-tier="7"] .paid-header')).toHaveCSS('background-color', 'rgb(239, 83, 80)');
    await expectUnifiedCards();
    await monitor.getByRole('button', { name: ja ? '取得を停止' : 'Stop collection', exact: true }).click();
    expect(requests).toEqual(['/youtube/v3/videos', '/youtube/v3/liveChat/messages']);
    await expect(watch.locator('body')).toHaveText('YouTube fixture');
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
