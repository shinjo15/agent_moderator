import { expect, it, vi } from 'vitest';
import { createYouTubeHandler } from '../src/youtube/background-handler';
import { failure } from '../src/youtube/contracts';

function setup() {
  const values: Record<string, unknown> = {};
  const session = {
    setAccessLevel: vi.fn(async () => {}),
    get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map(key => [key, values[key]]))),
    set: vi.fn(async (data: Record<string, unknown>) => { Object.assign(values, data); }),
    remove: vi.fn(async (keys: string[]) => { for (const key of keys) delete values[key]; }),
  };
  const tabs = { get: vi.fn(async (id: number) => ({ id, url: id === 9 ? 'https://www.youtube.com/watch?v=abcdefghijk' : 'chrome-extension://test/monitor.html' })),
    create: vi.fn(async () => ({ id: 10 })), update: vi.fn(async () => ({})) };
  const client = { resolveVideo: vi.fn().mockResolvedValue({ ok: true, value: { liveChatId: 'chat-1' } }),
    listMessages: vi.fn().mockResolvedValue({ ok: true, value: { messages: [], nextPageToken: 'next', pollingIntervalMillis: 8000, ended: false } }) };
  const readApiKey = vi.fn(async () => 'fixture-key' as string | undefined);
  let now = 0;
  const deps = { session, tabs, client, readApiKey, initialize: vi.fn(async () => {}),
    runtime: { id: 'test', getURL: (path: string) => `chrome-extension://test/${path}`, sendMessage: vi.fn(async () => {}) }, now: () => now };
  return { handler: createYouTubeHandler(deps), deps, values, advance: (n: number) => { now += n; } };
}
const popup = { id: 'test', url: 'chrome-extension://test/popup.html' };
const monitor = { id: 'test', url: 'chrome-extension://test/monitor.html', tab: { id: 10 } };
const open = { type: 'youtube.openMonitor', tabId: 9, videoId: 'abcdefghijk' };

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

it.each([11, 9])('新binding書込中の旧対象イベントは新対象tab %iを削除しない', async newTarget => {
  const { handler, deps, values } = setup();
  await handler.handle(open, popup);
  deps.tabs.get.mockImplementation(async id => ({ id, url: id === newTarget
    ? 'https://www.youtube.com/watch?v=zyxwvutsrqp'
    : id === 9 ? 'https://www.youtube.com/watch?v=abcdefghijk' : monitor.url }));
  const writing = deferred();
  const commit = deferred();
  const finishOldRead = deferred();
  deps.session.set.mockImplementation(async data => {
    if ('youtube.monitorBinding' in data) { writing.resolve(); await commit.promise; }
    Object.assign(values, data);
  });
  const newOpen = handler.handle({ ...open, tabId: newTarget, videoId: 'zyxwvutsrqp' }, popup);
  await writing.promise;
  deps.session.get.mockImplementation(async keys => {
    const snapshot = Object.fromEntries(keys.map(key => [key, values[key]]));
    if (keys.includes('youtube.monitorBinding')) await finishOldRead.promise;
    return snapshot;
  });
  const oldEvent = handler.targetChanged(9, newTarget === 9 ? 'https://www.youtube.com/watch?v=abcdefghijk' : undefined);
  // Let targetChanged reach its old read while the new write remains pending.
  await Promise.resolve();
  commit.resolve();
  expect(await newOpen).toMatchObject({ ok: true });
  finishOldRead.resolve();
  await oldEvent;
  expect(values['youtube.monitorBinding']).toEqual({ monitorTabId: 10, targetTabId: newTarget, videoId: 'zyxwvutsrqp' });
});

it('resolveの遅延binding書込を対象削除と交差させても旧bindingを復活させず即時Abortする', async () => {
  const { handler, deps, values } = setup();
  await handler.handle(open, popup);
  const writing = deferred();
  const commit = deferred();
  deps.session.set.mockImplementation(async data => {
    const selected = data['youtube.monitorBinding'] as { liveChatId?: string } | undefined;
    if (selected?.liveChatId) { writing.resolve(); await commit.promise; }
    Object.assign(values, data);
  });
  const request = handler.handle({ type: 'youtube.resolve', requestId: 'late-write', videoId: open.videoId }, monitor);
  await writing.promise;
  const changed = handler.targetChanged(9);
  expect((deps.client.resolveVideo.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
  // Drain the event's ready/read/remove microtasks while the resolve write is held.
  for (let i = 0; i < 20; i++) await Promise.resolve();
  commit.resolve();
  await changed;
  expect(values['youtube.monitorBinding']).toBeUndefined();
  expect(await request).toEqual(failure('aborted'));
});

it('API応答を待たず対象削除と再選択を完了し旧世代の結果を新bindingへ反映しない', async () => {
  const { handler, deps, values } = setup();
  await handler.handle(open, popup);
  const started = deferred();
  const finish = deferred<unknown>();
  deps.client.resolveVideo.mockImplementationOnce(() => { started.resolve(); return finish.promise; });
  const request = handler.handle({ type: 'youtube.resolve', requestId: 'late-api', videoId: open.videoId }, monitor);
  await started.promise;
  const changed = handler.targetChanged(9);
  expect((deps.client.resolveVideo.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
  await changed;
  expect(values['youtube.monitorBinding']).toBeUndefined();
  expect(await handler.handle(open, popup)).toMatchObject({ ok: true });
  finish.resolve({ ok: true, value: { liveChatId: 'old-generation-chat' } });
  expect(await request).toEqual(failure('aborted'));
  expect(values['youtube.monitorBinding']).toEqual({ monitorTabId: 10, targetTabId: 9, videoId: open.videoId });
});

it('popupの対象tabを照合してキーなしbindingを作り、monitorだけが一回取得できる', async () => {
  const { handler, deps, advance } = setup();
  expect(await handler.handle(open, popup)).toMatchObject({ ok: true });
  expect(await handler.handle({ type: 'youtube.status' }, monitor)).toEqual({ ok: true, value: { videoId: 'abcdefghijk', targetTabId: 9, credentialsAvailable: true } });
  expect(await handler.handle({ type: 'youtube.resolve', requestId: 'request-1', videoId: 'abcdefghijk' }, monitor))
    .toEqual({ ok: true, value: { liveChatId: 'chat-1' } });
  expect(deps.client.resolveVideo).toHaveBeenCalledWith('abcdefghijk', 'fixture-key', expect.any(AbortSignal));
  advance(5000);
  expect(await handler.handle({ type: 'youtube.list', requestId: 'request-2', liveChatId: 'chat-1' }, monitor)).toMatchObject({ ok: true });
  expect(deps.client.listMessages).toHaveBeenCalledWith('chat-1', undefined, 'fixture-key', expect.any(AbortSignal));
});

it('偽sender/content/options/query付きmonitor/別tabはAPIキー読取やfetch前に拒否する', async () => {
  const { handler, deps } = setup();
  await handler.handle(open, popup);
  deps.readApiKey.mockClear();
  for (const sender of [{ ...monitor, id: 'other' }, { ...monitor, url: 'https://www.youtube.com/live_chat' },
    { ...monitor, url: 'chrome-extension://test/options.html' }, { ...monitor, url: `${monitor.url}?fake=1` }, { ...monitor, tab: { id: 11 } }]) {
    expect(await handler.handle({ type: 'youtube.resolve', requestId: 'request-1', videoId: 'abcdefghijk' }, sender)).toEqual(failure('forbidden'));
  }
  expect(deps.readApiKey).not.toHaveBeenCalled();
  expect(deps.client.resolveVideo).not.toHaveBeenCalled();
});

it('worker再作成・再開でもsession cooldownと直近intervalを継承する', async () => {
  const { handler, deps, advance } = setup();
  await handler.handle(open, popup);
  await handler.handle({ type: 'youtube.resolve', requestId: 'request-1', videoId: 'abcdefghijk' }, monitor);
  const nextWorker = createYouTubeHandler(deps);
  expect(await nextWorker.handle({ type: 'youtube.list', requestId: 'request-2', liveChatId: 'chat-1' }, monitor)).toEqual(failure('rateLimited', 5000));
  advance(5000);
  await nextWorker.handle({ type: 'youtube.list', requestId: 'request-3', liveChatId: 'chat-1' }, monitor);
  advance(5000);
  expect(await createYouTubeHandler(deps).handle({ type: 'youtube.list', requestId: 'request-4', liveChatId: 'chat-1' }, monitor)).toEqual(failure('rateLimited', 3000));
  expect(deps.client.listMessages).toHaveBeenCalledTimes(1);
});

it('キー差替え/削除はAbortし遅延結果を返さず、動画遷移でも拒否する', async () => {
  const { handler, deps } = setup();
  await handler.handle(open, popup);
  let finish!: (result: unknown) => void;
  deps.client.resolveVideo.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const request = handler.handle({ type: 'youtube.resolve', requestId: 'request-1', videoId: 'abcdefghijk' }, monitor);
  await vi.waitFor(() => expect(deps.client.resolveVideo).toHaveBeenCalledTimes(1));
  deps.readApiKey.mockResolvedValue(undefined);
  await handler.credentialsChanged();
  expect((deps.client.resolveVideo.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
  finish({ ok: true, value: { liveChatId: 'stale' } });
  expect(await request).toEqual(failure('aborted'));
  deps.tabs.get.mockResolvedValue({ id: 9, url: 'https://www.youtube.com/watch?v=zyxwvutsrqp' });
  expect(await handler.handle({ type: 'youtube.resolve', requestId: 'request-2', videoId: 'abcdefghijk' }, monitor)).toEqual(failure('invalidInput'));
});
