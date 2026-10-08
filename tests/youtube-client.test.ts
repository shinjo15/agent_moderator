import { expect, it, vi } from 'vitest';
import { createYouTubeClient } from '../src/youtube/client';

it('応答待ちの通信は20秒で中断し固定networkエラーで停止する', async () => {
  vi.useFakeTimers();
  try {
    let requestSignal!: AbortSignal;
    const client = createYouTubeClient(vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      requestSignal = init.signal;
      requestSignal.addEventListener('abort', () => reject(new Error('private-url')), { once: true });
    })));
    const result = client.resolveVideo('abcdefghijk', 'fixture-key', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(19999);
    expect(requestSignal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(requestSignal.aborted).toBe(true);
    expect(await result).toMatchObject({ ok: false, error: { code: 'network' } });
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

it('Google RPC ErrorInfoのキー制限エラーも固定authに分類する', async () => {
  const client = createYouTubeClient(vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: {
    details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID', metadata: { key: 'private-key' } }],
  } }), { status: 400 })));
  expect(await client.resolveVideo('abcdefghijk', 'fixture-key', new AbortController().signal))
    .toMatchObject({ ok: false, error: { code: 'auth' } });
});

it('HTTP-dateのRetry-Afterを尊重し、不正な値は既定待機へ任せる', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  try {
    const client = createYouTubeClient(vi.fn().mockResolvedValue(new Response('{}', {
      status: 503, headers: { 'Retry-After': 'Thu, 01 Jan 2026 00:01:00 GMT' },
    })));
    expect(await client.resolveVideo('abcdefghijk', 'fixture-key', new AbortController().signal))
      .toMatchObject({ ok: false, error: { code: 'unavailable', retryAfterMillis: 60000 } });
  } finally { vi.useRealTimers(); }
});

const message = { id: 'msg-1', snippet: { type: 'textMessageEvent', hasDisplayContent: true, displayMessage: 'こんにちは' }, authorDetails: { channelId: 'channel-1' } };
const chatPage = { nextPageToken: 'next-1', pollingIntervalMillis: 8000, items: [message] };
it('既取得authorDetails.displayNameをIDとは別に伝播し追加requestやfields変更をしない', async () => {
  const name = 'みどり <img src=x onerror=alert(1)>';
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...chatPage,
    items: [{ ...message, authorDetails: { ...message.authorDetails, displayName: name } }] })));
  const result = await createYouTubeClient(fetcher).listMessages('chat', undefined, 'synthetic', new AbortController().signal);
  expect(result).toMatchObject({ ok: true, value: { messages: [{ authorChannelId: 'channel-1', authorDisplayName: name }] } });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const url = new URL(fetcher.mock.calls[0][0]);
  expect(url.searchParams.get('part')).toBe('id,snippet,authorDetails');
  expect(url.searchParams.has('fields')).toBe(false);
});
it.each([undefined, null, 123, '', '   '])('取得できない名前 %j を推測せず既存IDを保持する', async displayName => {
  const client = createYouTubeClient(vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...chatPage,
    items: [{ ...message, authorDetails: { ...message.authorDetails, displayName } }] }))));
  const result = await client.listMessages('chat', undefined, 'synthetic', new AbortController().signal);
  expect(result).toMatchObject({ ok: true, value: { messages: [{ authorChannelId: 'channel-1' }] } });
  if (result.ok) expect(result.value.messages[0]).not.toHaveProperty('authorDisplayName');
});
it('既存listのpublishedAtを任意に取り込み欠落/不正を捏造しない', async () => {
  for (const publishedAt of ['2026-01-01T00:00:00Z', undefined, 'invalid']) {
    const client = createYouTubeClient(vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...chatPage, items: [{ ...message, snippet: { ...message.snippet, publishedAt } }] }))));
    const result = await client.listMessages('chat', undefined, 'synthetic', new AbortController().signal);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.value.messages[0].publishedAt).toBe(publishedAt === '2026-01-01T00:00:00Z' ? publishedAt : undefined);
  }
});

it.each([
  [403, 'liveChatDisabled', 'chatDisabled'], [403, 'liveChatEnded', 'ended'],
  [404, 'liveChatNotFound', 'notFound'], [403, 'quotaExceeded', 'quota'],
  [400, 'keyInvalid', 'auth'], [403, 'accessNotConfigured', 'auth'], [401, '', 'auth'],
  [403, 'forbidden', 'forbidden'], [429, 'rateLimitExceeded', 'rateLimited'],
  [503, '', 'unavailable'], [500, '', 'unavailable'], [400, 'unknown', 'api'],
])('HTTP %i / %s は固定エラー %s へ変換し生データを漏らさない', async (status, reason, code) => {
  for (const method of ['video', 'chat']) {
    const client = createYouTubeClient(vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: {
      message: 'secret-key https://secret.invalid/?key=secret-key', errors: [{ reason }],
    } }), { status, headers: { 'Retry-After': '12' } })));
    const result = method === 'video'
      ? await client.resolveVideo('abcdefghijk', 'secret-key', new AbortController().signal)
      : await client.listMessages('chat-1', undefined, 'secret-key', new AbortController().signal);
    expect(result).toMatchObject({ ok: false, error: { code } });
    expect(JSON.stringify(result)).not.toMatch(/secret|https:/);
    if (status === 429 || status === 503) expect(result).toMatchObject({ error: { retryAfterMillis: 12000 } });
  }
});

it('通信例外・壊れたJSON・Abortを安全な結果へ変換する', async () => {
  const signal = new AbortController().signal;
  const network = createYouTubeClient(vi.fn().mockRejectedValue(new Error('secret-key https://secret.invalid')));
  expect(await network.resolveVideo('abcdefghijk', 'fixture-key', signal)).toMatchObject({ ok: false, error: { code: 'network' } });
  const invalid = createYouTubeClient(vi.fn().mockResolvedValue(new Response('secret-key')));
  expect(await invalid.listMessages('chat-1', undefined, 'fixture-key', signal)).toMatchObject({ ok: false, error: { code: 'invalidResponse' } });
  const controller = new AbortController();
  controller.abort();
  const fetcher = vi.fn();
  expect(await createYouTubeClient(fetcher).resolveVideo('abcdefghijk', 'fixture-key', controller.signal))
    .toMatchObject({ ok: false, error: { code: 'aborted' } });
  expect(fetcher).not.toHaveBeenCalled();
});

it('不正な入力は通信せず拒否する', async () => {
  const fetcher = vi.fn();
  const client = createYouTubeClient(fetcher);
  const signal = new AbortController().signal;
  expect(await client.resolveVideo('https://example.com', 'fixture-key', signal)).toMatchObject({ ok: false, error: { code: 'invalidInput' } });
  expect(await client.resolveVideo('abcdefghijk', '', signal)).toMatchObject({ ok: false, error: { code: 'auth' } });
  expect(await client.listMessages('', undefined, 'fixture-key', signal)).toMatchObject({ ok: false, error: { code: 'invalidInput' } });
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  {}, { ...chatPage, nextPageToken: undefined }, { ...chatPage, nextPageToken: '' },
  { ...chatPage, pollingIntervalMillis: undefined }, { ...chatPage, pollingIntervalMillis: 0 },
  { ...chatPage, pollingIntervalMillis: -1 }, { ...chatPage, pollingIntervalMillis: 1.5 },
  { ...chatPage, items: undefined }, { ...chatPage, items: [{}] },
  { ...chatPage, items: [{ ...message, id: '' }] },
  { ...chatPage, items: [{ ...message, authorDetails: {} }] },
  { ...chatPage, items: [{ ...message, snippet: { type: 'textMessageEvent', hasDisplayContent: true } }] },
  { ...chatPage, offlineAt: 'invalid' },
])('必須値が欠ける/不正なlist応答 %j を拒否する', async body => {
  const client = createYouTubeClient(vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
  expect(await client.listMessages('chat-1', undefined, 'fixture-key', new AbortController().signal))
    .toMatchObject({ ok: false, error: { code: 'invalidResponse' } });
});

it('silent tombstoneは本文欠落を許容し、chatEndedEventで終了を返す', async () => {
  const client = createYouTubeClient(vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...chatPage, items: [
    { id: 'silent', snippet: { type: 'tombstone', hasDisplayContent: false } },
    { id: 'end', snippet: { type: 'chatEndedEvent', hasDisplayContent: false } },
  ] }))));
  expect(await client.listMessages('chat-1', undefined, 'fixture-key', new AbortController().signal))
    .toEqual({ ok: true, value: { messages: [], nextPageToken: 'next-1', pollingIntervalMillis: 8000, ended: true } });
});

it('listで続きを指定し、本文・投稿者と継続用必須値だけを返す', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(chatPage)));
  const client = createYouTubeClient(fetcher);
  expect(await client.listMessages('chat-1', 'previous-1', 'fixture-key', new AbortController().signal))
    .toEqual({ ok: true, value: { nextPageToken: 'next-1', pollingIntervalMillis: 8000, ended: false,
      messages: [{ id: 'msg-1', text: 'こんにちは', authorChannelId: 'channel-1', type: 'textMessageEvent' }] } });
  const url = new URL(fetcher.mock.calls[0][0]);
  expect(url.pathname).toBe('/youtube/v3/liveChat/messages');
  expect(url.searchParams.get('part')).toBe('id,snippet,authorDetails');
  expect(url.searchParams.get('pageToken')).toBe('previous-1');
});

it('公開動画からactiveLiveChatIdを取得し、APIキーはGoogleへの要求だけに渡す', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    items: [{ id: 'abcdefghijk', liveStreamingDetails: { actualStartTime: '2026-01-01T00:00:00Z', activeLiveChatId: 'chat-1' } }],
  })));
  const client = createYouTubeClient(fetcher);
  expect(await client.resolveVideo('abcdefghijk', 'fixture-key', new AbortController().signal))
    .toEqual({ ok: true, value: { liveChatId: 'chat-1' } });
  const [url, init] = fetcher.mock.calls[0];
  expect(new URL(url).origin).toBe('https://www.googleapis.com');
  expect(new URL(url).searchParams.get('part')).toBe('liveStreamingDetails');
  expect(new URL(url).searchParams.get('key')).toBe('fixture-key');
  expect(init.credentials).toBe('omit');
});

it.each([
  [{ items: [] }, 'notFound'],
  [{ items: [{ id: 'abcdefghijk' }] }, 'notLive'],
  [{ items: [{ id: 'abcdefghijk', liveStreamingDetails: { scheduledStartTime: '2026-01-01T00:00:00Z' } }] }, 'notLive'],
  [{ items: [{ id: 'abcdefghijk', liveStreamingDetails: { actualStartTime: '2026-01-01T00:00:00Z' } }] }, 'chatDisabled'],
  [{ items: [{ id: 'abcdefghijk', liveStreamingDetails: { actualEndTime: '2026-01-01T00:00:00Z' } }] }, 'ended'],
  [{}, 'invalidResponse'],
  [{ items: [{}] }, 'invalidResponse'],
  [{ items: [{ id: 'different-id' }] }, 'invalidResponse'],
  [{ items: [{ id: 'abcdefghijk', liveStreamingDetails: { activeLiveChatId: '' } }] }, 'invalidResponse'],
])('動画応答 %j を %s に分類する', async (body, code) => {
  const client = createYouTubeClient(vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
  expect(await client.resolveVideo('abcdefghijk', 'fixture-key', new AbortController().signal))
    .toMatchObject({ ok: false, error: { code } });
});
