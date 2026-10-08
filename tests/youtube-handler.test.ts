import { expect, it, vi } from 'vitest';
import { createYouTubeHandler } from '../src/youtube/background-handler';
import { failure } from '../src/youtube/contracts';
import { createModeration as createUnconfirmedModeration } from '../src/jev/moderation';
import { createJevClient } from '../src/jev/client';
import { apiResponse, chatPost } from './fixtures/jev';
import { createHiddenAuthors } from '../src/hidden-authors/store';
import { createYouTubeClient } from '../src/youtube/client';
import { createConfirmation, CONFIRMATION_KEY, CONFIRMATION_VERSION } from '../src/confirmation';
const createModeration = (deps: Parameters<typeof createUnconfirmedModeration>[0]) =>
  createUnconfirmedModeration({ readConfirmation: async () => true, ...deps });

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
  const deps = { session, tabs, client, readApiKey, readConfirmation: vi.fn(async () => true), initialize: vi.fn(async () => {}),
    runtime: { id: 'test', getURL: (path: string) => `chrome-extension://test/${path}`, sendMessage: vi.fn(async () => {}) }, now: () => now };
  return { handler: createYouTubeHandler(deps), deps, values, advance: (n: number) => { now += n; } };
}
const popup = { id: 'test', url: 'chrome-extension://test/popup.html' };
const monitor = { id: 'test', url: 'chrome-extension://test/monitor.html', tab: { id: 10 } };
const open = { type: 'youtube.openMonitor', tabId: 9, videoId: 'abcdefghijk' };
it.each([
  ['preparation', true], ['preparation', false], ['send', true], ['send', false],
] as const)('全削除はconfirmation %s await中の旧要求を失効（遅延確認=%s）し新Jev許可を止めない', async (checkpoint, confirmed) => {
  const { deps, values } = setup();
  deps.session.get.mockImplementation(async keys => keys === null ? structuredClone(values) : Object.fromEntries(keys.map(key => [key, values[key]])));
  const hiddenAuthors = createHiddenAuthors({ storage: deps.session, initialize: deps.initialize });
  const fetcher = vi.fn(async () => new Response(JSON.stringify(apiResponse())));
  const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic' });
  const handler = createYouTubeHandler({ ...deps, hiddenAuthors, moderation });
  await handler.handle(open, popup); deps.readApiKey.mockClear();
  const entered = deferred(); const release = deferred<boolean>();
  if (checkpoint === 'send') deps.readConfirmation.mockResolvedValueOnce(true);
  deps.readConfirmation.mockImplementationOnce(() => { entered.resolve(); return release.promise; });
  const old = handler.handle({ type: 'youtube.resolve', requestId: 'confirmation-wait', videoId: open.videoId }, monitor);
  await entered.promise;
  await handler.clearHiddenData();
  expect(await handler.handle({ type: 'jev.enable' }, monitor)).toEqual({ ok: true });
  release.resolve(confirmed);
  expect(await old).toEqual(failure('aborted'));
  expect(deps.client.resolveVideo).not.toHaveBeenCalled();
  expect(deps.readApiKey).toHaveBeenCalledTimes(checkpoint === 'preparation' ? 0 : 1);
  if (checkpoint === 'preparation') expect(values['youtube.cooldown']).toBeUndefined();
  expect(Object.keys(values).some(key => key.startsWith('hiddenAuthors.'))).toBe(false);
  moderation.observe([chatPost('new-explicit-enable')]);
  expect(await moderation.evaluate('new-explicit-enable')).toMatchObject({ ok: true, value: { jev: 'evaluated' } });
  expect(fetcher).toHaveBeenCalledTimes(1); moderation.reset();
});
it.each([
  ['jev.enable', true], ['jev.enable', false], ['jev.evaluate', true], ['jev.evaluate', false],
] as const)('全削除は%s内部confirmation await中も失効（遅延確認=%s）し新許可を止めない', async (type, confirmed) => {
  const { deps, values } = setup();
  deps.session.get.mockImplementation(async keys => keys === null ? structuredClone(values) : Object.fromEntries(keys.map(key => [key, values[key]])));
  const hiddenAuthors = createHiddenAuthors({ storage: deps.session, initialize: deps.initialize });
  const fetcher = vi.fn(async () => new Response(JSON.stringify(apiResponse())));
  const readConfirmation = vi.fn(async () => true);
  const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic', readConfirmation });
  const handler = createYouTubeHandler({ ...deps, hiddenAuthors, moderation });
  await handler.handle(open, popup);
  if (type === 'jev.evaluate') {
    await handler.handle({ type: 'jev.enable' }, monitor);
    moderation.observe([chatPost('old-confirmation-wait')]);
  }
  const entered = deferred(); const release = deferred<boolean>();
  readConfirmation.mockImplementationOnce(() => { entered.resolve(); return release.promise; });
  const old = handler.handle(type === 'jev.enable' ? { type } : { type, id: 'old-confirmation-wait' }, monitor);
  await entered.promise; await handler.clearHiddenData();
  expect(await handler.handle({ type: 'jev.enable' }, monitor)).toEqual({ ok: true });
  release.resolve(confirmed);
  expect(await old).toEqual(failure('aborted'));
  expect(fetcher).not.toHaveBeenCalled();
  expect(Object.keys(values).some(key => key.startsWith('hiddenAuthors.'))).toBe(false);
  moderation.observe([chatPost('new-confirmed-post')]);
  expect(await moderation.evaluate('new-confirmed-post')).toMatchObject({ ok: true, value: { jev: 'evaluated' } });
  expect(fetcher).toHaveBeenCalledTimes(1); moderation.reset();
});
it('全削除で遅延list/queueとcached判定を失効、cooldown保持、明示resolve後の新規判定だけ再登録', async () => {
  const { deps, advance, values } = setup();
  // Test storage emulates Chrome get(null), without reading a real user profile.
  deps.session.get.mockImplementation(async keys => keys === null ? structuredClone(values) : Object.fromEntries(keys.map(key => [key, values[key]])));
  const hiddenAuthors = createHiddenAuthors({ storage: deps.session, initialize: deps.initialize });
  const moderation = createModeration({ client: createJevClient(async () => new Response(JSON.stringify(apiResponse({ attack: 1 })))), readKey: async () => 'synthetic', session: deps.session, now: deps.now });
  const handler = createYouTubeHandler({ ...deps, moderation, hiddenAuthors });
  await handler.handle(open, popup); await handler.handle({ type: 'jev.enable' }, monitor);
  await handler.handle({ type: 'youtube.resolve', requestId: 'initial', videoId: open.videoId }, monitor); advance(5000);
  const post = { ...chatPost('cached'), authorChannelId: 'UCabcdefghijklmnopqrstuv', authorDisplayName: '名前' };
  deps.client.listMessages.mockResolvedValue({ ok: true, value: { messages: [post], nextPageToken: 'next', pollingIntervalMillis: 8000, ended: false } });
  await handler.handle({ type: 'youtube.list', requestId: 'cached-list', liveChatId: 'chat-1' }, monitor);
  await handler.handle({ type: 'jev.evaluate', id: 'cached' }, monitor);
  expect(await hiddenAuthors.list(open.videoId)).toEqual([post.authorChannelId]); advance(8000);
  const entered = deferred(); const late = deferred<unknown>();
  deps.client.listMessages.mockImplementationOnce(() => { entered.resolve(); return late.promise; });
  const first = handler.handle({ type: 'youtube.list', requestId: 'late-list', liveChatId: 'chat-1' }, monitor); await entered.promise;
  const queued = handler.handle({ type: 'youtube.resolve', requestId: 'queued', videoId: open.videoId }, monitor);
  values['jev.notBefore'] = 12345;
  const cooldown = structuredClone(values['youtube.cooldown']);
  await handler.clearHiddenData();
  expect(values['youtube.cooldown']).toEqual(cooldown); expect(values['jev.notBefore']).toBe(12345);
  late.resolve({ ok: true, value: { messages: [post], nextPageToken: 'late', pollingIntervalMillis: 8000, ended: false } });
  expect(await first).toEqual(failure('aborted')); expect(await queued).toEqual(failure('aborted'));
  expect(await handler.handle({ type: 'jev.evaluate', id: 'cached' }, monitor)).toMatchObject({ ok: false });
  expect(await handler.handle({ type: 'youtube.list', requestId: 'old-page', liveChatId: 'chat-1' }, monitor)).toMatchObject({ ok: false });
  expect(await hiddenAuthors.list(open.videoId)).toEqual([]);
  expect(await handler.handle({ type: 'youtube.resolve', requestId: 'too-soon', videoId: open.videoId }, monitor)).toMatchObject({ ok: false, error: { code: 'rateLimited' } });
  advance(30000);
  expect(await handler.handle({ type: 'jev.enable' }, monitor)).toEqual({ ok: true });
  expect(await handler.handle({ type: 'youtube.resolve', requestId: 'restart', videoId: open.videoId }, monitor)).toMatchObject({ ok: true }); advance(8000);
  deps.client.listMessages.mockResolvedValue({ ok: true, value: { messages: [{ ...post, id: 'new' }], nextPageToken: 'new', pollingIntervalMillis: 8000, ended: false } });
  expect(await handler.handle({ type: 'youtube.list', requestId: 'new-list', liveChatId: 'chat-1' }, monitor)).toMatchObject({ ok: true });
  expect(await handler.handle({ type: 'jev.evaluate', id: 'new' }, monitor)).toMatchObject({ ok: true });
  expect(await hiddenAuthors.list(open.videoId)).toEqual([post.authorChannelId]);
  moderation.reset();
});
it('全削除後にworkerを再作成しても旧listは停止し、新明示resolveだけが再開できる', async () => {
  const { deps, advance, values } = setup();
  deps.session.get.mockImplementation(async keys => keys === null ? structuredClone(values) : Object.fromEntries(keys.map(key => [key, values[key]])));
  const hiddenAuthors = createHiddenAuthors({ storage: deps.session, initialize: deps.initialize });
  const handler = createYouTubeHandler({ ...deps, hiddenAuthors });
  await handler.handle(open, popup);
  await handler.handle({ type: 'youtube.resolve', requestId: 'initial', videoId: open.videoId }, monitor);
  await handler.clearHiddenData(); advance(30000);
  const restarted = createYouTubeHandler({ ...deps, hiddenAuthors: createHiddenAuthors({ storage: deps.session, initialize: deps.initialize }) });
  expect(await restarted.handle({ type: 'youtube.list', requestId: 'stale', liveChatId: 'chat-1' }, monitor)).toEqual(failure('aborted'));
  expect(deps.client.listMessages).not.toHaveBeenCalled();
  expect(await restarted.handle({ type: 'youtube.resolve', requestId: 'explicit', videoId: open.videoId }, monitor)).toMatchObject({ ok: true });
  advance(5000);
  expect(await restarted.handle({ type: 'youtube.list', requestId: 'fresh', liveChatId: 'chat-1' }, monitor)).toMatchObject({ ok: true });
});
it('全削除は停止制御の保存がreadbackできない場合も成功せず非表示storageを消さない', async () => {
  const { deps, values } = setup();
  deps.session.get.mockImplementation(async keys => keys === null ? structuredClone(values) : Object.fromEntries(keys.map(key => [key, values[key]])));
  const hiddenAuthors = createHiddenAuthors({ storage: deps.session, initialize: deps.initialize });
  const handler = createYouTubeHandler({ ...deps, hiddenAuthors });
  await handler.handle(open, popup);
  await hiddenAuthors.add(open.videoId, 'UCabcdefghijklmnopqrstuv', 0);
  deps.session.set.mockResolvedValueOnce(undefined);
  await expect(handler.clearHiddenData()).rejects.toThrow();
  expect(await hiddenAuthors.list(open.videoId)).toEqual(['UCabcdefghijklmnopqrstuv']);
  expect(await handler.handle({ type: 'youtube.list', requestId: 'old', liveChatId: 'chat-1' }, monitor)).toEqual(failure('aborted'));
});
it('全削除はinflight Jevをabortし、遅い応答とcached操作でも復活させない', async () => {
  const { deps, advance, values } = setup();
  deps.session.get.mockImplementation(async keys => keys === null ? structuredClone(values) : Object.fromEntries(keys.map(key => [key, values[key]])));
  const hiddenAuthors = createHiddenAuthors({ storage: deps.session, initialize: deps.initialize });
  const entered = deferred(); const response = deferred<Response>(); let signal: AbortSignal | undefined;
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => { signal = init?.signal as AbortSignal; entered.resolve(); return response.promise; });
  const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic', session: deps.session, now: deps.now });
  const handler = createYouTubeHandler({ ...deps, moderation, hiddenAuthors });
  await handler.handle(open, popup); await handler.handle({ type: 'jev.enable' }, monitor);
  await handler.handle({ type: 'youtube.resolve', requestId: 'initial', videoId: open.videoId }, monitor); advance(5000);
  deps.client.listMessages.mockResolvedValue({ ok: true, value: { messages: [chatPost('late')], nextPageToken: 'next', pollingIntervalMillis: 8000, ended: false } });
  await handler.handle({ type: 'youtube.list', requestId: 'list', liveChatId: 'chat-1' }, monitor);
  const pending = handler.handle({ type: 'jev.evaluate', id: 'late' }, monitor); await entered.promise;
  await handler.clearHiddenData(); expect(signal?.aborted).toBe(true);
  response.resolve(new Response(JSON.stringify(apiResponse({ attack: 1 }))));
  expect(await pending).toEqual(failure('aborted'));
  expect(await handler.handle({ type: 'jev.evaluate', id: 'late' }, monitor)).toMatchObject({ ok: false });
  expect(await hiddenAuthors.list(open.videoId)).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(1); moderation.reset();
});
it.each(['youtube.resolve', 'jev.enable'] as const)('全削除前の%sのbinding snapshotが遅れても新世代のAPI/許可に入らない', async type => {
  const { deps, values } = setup();
  deps.session.get.mockImplementation(async keys => keys === null ? structuredClone(values) : Object.fromEntries(keys.map(key => [key, values[key]])));
  const hiddenAuthors = createHiddenAuthors({ storage: deps.session, initialize: deps.initialize });
  const moderation = createModeration({ client: createJevClient(vi.fn()), readKey: async () => 'synthetic' });
  const enable = vi.spyOn(moderation, 'enable');
  const handler = createYouTubeHandler({ ...deps, moderation, hiddenAuthors }); await handler.handle(open, popup);
  const entered = deferred(); const gate = deferred();
  deps.session.get.mockImplementationOnce(async keys => { const snapshot = Object.fromEntries(keys.map(key => [key, values[key]])); entered.resolve(); await gate.promise; return snapshot; });
  const stale = handler.handle({ type, requestId: 'old', videoId: open.videoId }, monitor); await entered.promise;
  await handler.clearHiddenData(); gate.resolve();
  expect(await stale).toEqual(failure('aborted')); expect(enable).not.toHaveBeenCalled(); expect(deps.client.resolveVideo).not.toHaveBeenCalled();
  moderation.reset();
});
it('旧runtime経由の未確認・読取失敗・確認喪失ではYouTube実通信しない', async () => {
  const { deps, advance } = setup();
  const readConfirmation = vi.fn(async () => false);
  const handler = createYouTubeHandler({ ...deps, readConfirmation });
  await handler.handle(open, popup);
  const resolve = { type: 'youtube.resolve', requestId: 'r', videoId: open.videoId };
  expect(await handler.handle(resolve, monitor)).toMatchObject({ ok: false, error: { code: 'confirmationRequired' } });
  expect(deps.client.resolveVideo).not.toHaveBeenCalled();
  readConfirmation.mockRejectedValueOnce(new Error('private'));
  expect(await handler.handle(resolve, monitor)).toMatchObject({ ok: false });
  expect(deps.client.resolveVideo).not.toHaveBeenCalled();
  readConfirmation.mockResolvedValue(true);
  expect(await handler.handle(resolve, monitor)).toMatchObject({ ok: true });
  advance(5000); readConfirmation.mockResolvedValue(false);
  expect(await handler.handle({ type: 'youtube.list', requestId: 'l', liveChatId: 'chat-1' }, monitor)).toMatchObject({ ok: false });
  expect(deps.client.listMessages).not.toHaveBeenCalled();
});

it('複数画面から確認状態が変更されたら準備中の旧取得は再確認済みでも送信しない', async () => {
  const { handler, deps } = setup();
  await handler.handle(open, popup);
  const reading = deferred(); const key = deferred<string | undefined>();
  deps.readApiKey.mockImplementationOnce(() => { reading.resolve(); return key.promise; });
  const pending = handler.handle({ type: 'youtube.resolve', requestId: 'preparing', videoId: open.videoId }, monitor);
  await reading.promise;
  await handler.confirmationChanged(); key.resolve('fixture-key');
  expect(await pending).toMatchObject({ ok: false, error: { code: 'aborted' } });
  expect(deps.client.resolveVideo).not.toHaveBeenCalled();
});

it.each([
  ['ready', 'youtube.resolve'], ['ready', 'jev.enable'], ['binding', 'youtube.resolve'],
  ['binding', 'jev.enable'], ['target', 'youtube.resolve'], ['target', 'jev.enable'],
] as const)('確認変更は%s待ちの旧%sを失効し明示再開だけ許可する', async (wait, type) => {
    const { deps, values } = setup();
    values['youtube.monitorBinding'] = { monitorTabId: 10, targetTabId: 9, videoId: open.videoId };
    const entered = deferred(); const release = deferred();
    if (wait === 'ready') deps.initialize.mockImplementationOnce(async () => { entered.resolve(); await release.promise; });
    if (wait === 'binding') deps.session.get.mockImplementation(async keys => {
      const snapshot = Object.fromEntries(keys.map(key => [key, values[key]]));
      if (keys.includes('youtube.monitorBinding')) { entered.resolve(); await release.promise; }
      return snapshot;
    });
    if (wait === 'target') deps.tabs.get.mockImplementationOnce(async id => {
      entered.resolve(); await release.promise; return { id, url: 'https://www.youtube.com/watch?v=abcdefghijk' };
    });
    const youtubeFetch = vi.fn(async () => new Response(JSON.stringify({ items: [{ id: open.videoId, liveStreamingDetails: { activeLiveChatId: 'chat-1' } }] })));
    const jevFetch = vi.fn(async () => new Response(JSON.stringify(apiResponse())));
    const moderation = createModeration({ client: createJevClient(jevFetch), readKey: async () => 'synthetic' });
    const handler = createYouTubeHandler({ ...deps, moderation, client: createYouTubeClient(youtubeFetch) });
    const request = { type, requestId: 'old', videoId: open.videoId };
    const pending = handler.handle(type === 'jev.enable' ? { type } : request, monitor);
    await entered.promise; await handler.confirmationChanged(); release.resolve();
    expect(await pending).toEqual(failure('aborted'));
    moderation.observe([chatPost('stale-enable')]); await moderation.evaluate('stale-enable');
    expect(youtubeFetch).not.toHaveBeenCalled(); expect(jevFetch).not.toHaveBeenCalled();
    expect(await handler.handle(type === 'jev.enable' ? { type } : { ...request, requestId: 'new' }, monitor)).toMatchObject({ ok: true });
    if (type === 'jev.enable') { moderation.observe([chatPost('explicit-resume', 1)]); await moderation.evaluate('explicit-resume'); expect(jevFetch).toHaveBeenCalledTimes(1); }
    else expect(youtubeFetch).toHaveBeenCalledTimes(1);
    moderation.reset();
});

it.each([
  ['localKey', true], ['notBefore', true], ['localKey', false], ['notBefore', false],
] as const)('Jev enable内部%s遅延rejectは確認変更=%sの世代だけを停止する', async (wait, changed) => {
  const { deps } = setup();
  const localValues: Record<string, unknown> = { [CONFIRMATION_KEY]: { version: CONFIRMATION_VERSION }, 'apiKey.jev': 'synthetic' };
  const local = {
    setAccessLevel: vi.fn(async () => {}),
    get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map(key => [key, localValues[key]]))),
    set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(localValues, values); }),
  };
  vi.stubGlobal('chrome', { storage: { local } });
  const { initializeCredentialStorage, readJevApiKeyForBackground } = await import('../src/credential-store');
  const confirmation = createConfirmation({ storage: local, initialize: initializeCredentialStorage });
  const fetcher = vi.fn(async () => new Response(JSON.stringify(apiResponse())));
  const moderation = createUnconfirmedModeration({ client: createJevClient(fetcher), readKey: readJevApiKeyForBackground,
    readConfirmation: confirmation.read, session: deps.session });
  const enable = vi.spyOn(moderation, 'enable');
  const handler = createYouTubeHandler({ ...deps, moderation, readConfirmation: confirmation.read });
  try {
    await handler.handle(open, popup);
    expect(await handler.handle({ type: 'jev.enable' }, monitor)).toEqual({ ok: true });
    moderation.observe([chatPost('before-reject')]);
    const entered = deferred(); let reject!: (error: Error) => void;
    const pendingRead = new Promise<Record<string, unknown>>((_resolve, fail) => { reject = fail; });
    const storage = wait === 'localKey' ? local : deps.session;
    const originalGet = storage.get.getMockImplementation()!;
    let delayed = false;
    storage.get.mockImplementation(keys => {
      if (!delayed && keys.includes(wait === 'localKey' ? 'apiKey.jev' : 'jev.notBefore')) {
        delayed = true; entered.resolve(); return pendingRead;
      }
      return originalGet(keys);
    });
    const oldEnable = handler.handle({ type: 'jev.enable' }, monitor);
    await entered.promise;
    if (changed) {
      await handler.confirmationChanged();
      expect(deps.runtime.sendMessage).toHaveBeenCalledWith({ type: 'confirmation.changed' });
      expect(await handler.handle({ type: 'jev.enable' }, monitor)).toEqual({ ok: true });
    }
    moderation.observe([chatPost('new-post', 1)]);
    expect(fetcher).not.toHaveBeenCalled();
    reject(new Error('synthetic-read-rejection'));
    expect(await oldEnable).toMatchObject({ ok: false, error: { code: changed ? 'aborted' : 'network' } });
    expect(await handler.handle({ type: 'jev.evaluate', id: 'new-post' }, monitor))
      .toMatchObject({ ok: true, value: { jev: changed ? 'evaluated' : 'disabled' } });
    expect(fetcher).toHaveBeenCalledTimes(changed ? 1 : 0);
    // The handler's epoch check alone can hide a core network failure and its stop side effect.
    expect(await enable.mock.results[1].value).toEqual({ ok: false, error: { code: changed ? 'aborted' : 'network' } });
    if (!changed) {
      expect(await handler.handle({ type: 'jev.enable' }, monitor)).toEqual({ ok: true });
      moderation.observe([chatPost('explicit-resume', 2)]);
      expect(await handler.handle({ type: 'jev.evaluate', id: 'explicit-resume' }, monitor))
        .toMatchObject({ ok: true, value: { jev: 'evaluated' } });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  } finally { moderation.reset(); vi.unstubAllGlobals(); vi.resetModules(); }
});

it.each(['localKey', 'notBefore'] as const)('全削除後の明示newenableを旧%s遅延rejectが停止せず新評価を維持する', async wait => {
  const { deps, values } = setup();
  deps.session.get.mockImplementation(async keys => keys === null ? structuredClone(values) : Object.fromEntries(keys.map(key => [key, values[key]])));
  const localValues: Record<string, unknown> = { [CONFIRMATION_KEY]: { version: CONFIRMATION_VERSION }, 'apiKey.jev': 'synthetic' };
  const local = {
    setAccessLevel: vi.fn(async () => {}),
    get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map(key => [key, localValues[key]]))),
    set: vi.fn(async (data: Record<string, unknown>) => { Object.assign(localValues, data); }),
  };
  vi.stubGlobal('chrome', { storage: { local } });
  const { initializeCredentialStorage, readJevApiKeyForBackground } = await import('../src/credential-store');
  const confirmation = createConfirmation({ storage: local, initialize: initializeCredentialStorage });
  const hiddenAuthors = createHiddenAuthors({ storage: deps.session, initialize: deps.initialize });
  const fetcher = vi.fn(async () => new Response(JSON.stringify(apiResponse())));
  const moderation = createUnconfirmedModeration({ client: createJevClient(fetcher), readKey: readJevApiKeyForBackground,
    readConfirmation: confirmation.read, session: deps.session });
  const enable = vi.spyOn(moderation, 'enable');
  const handler = createYouTubeHandler({ ...deps, moderation, hiddenAuthors, readConfirmation: confirmation.read });
  try {
    await handler.handle(open, popup);
    await hiddenAuthors.add(open.videoId, 'UCabcdefghijklmnopqrstuv', 0);
    expect(await hiddenAuthors.list(open.videoId)).toEqual(['UCabcdefghijklmnopqrstuv']);
    const entered = deferred(); let reject!: (error: Error) => void;
    const pendingRead = new Promise<Record<string, unknown>>((_resolve, fail) => { reject = fail; });
    const storage = wait === 'localKey' ? local : deps.session;
    const originalGet = storage.get.getMockImplementation()!;
    let delayed = false;
    storage.get.mockImplementation(keys => {
      if (!delayed && keys !== null && keys.includes(wait === 'localKey' ? 'apiKey.jev' : 'jev.notBefore')) {
        delayed = true; entered.resolve(); return pendingRead;
      }
      return originalGet(keys);
    });
    const oldEnable = handler.handle({ type: 'jev.enable' }, monitor);
    await entered.promise;
    await handler.clearHiddenData();
    expect(await hiddenAuthors.list(open.videoId)).toEqual([]);
    expect(deps.runtime.sendMessage).toHaveBeenCalledTimes(2);
    expect(deps.runtime.sendMessage).toHaveBeenNthCalledWith(1, { type: 'hidden.clearing' });
    expect(deps.runtime.sendMessage).toHaveBeenNthCalledWith(2, { type: 'hidden.refresh' });
    expect(localValues[CONFIRMATION_KEY]).toEqual({ version: CONFIRMATION_VERSION });
    expect(await handler.handle({ type: 'jev.enable' }, monitor)).toEqual({ ok: true });
    moderation.observe([chatPost('post-after-clear', 1)]);
    expect(fetcher).not.toHaveBeenCalled();
    reject(new Error('synthetic-old-read-rejection'));
    expect(await oldEnable).toEqual(failure('aborted'));
    expect(await handler.handle({ type: 'jev.evaluate', id: 'post-after-clear' }, monitor))
      .toMatchObject({ ok: true, value: { jev: 'evaluated' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await enable.mock.results[0].value).toEqual({ ok: false, error: { code: 'aborted' } });
    expect(await hiddenAuthors.list(open.videoId)).toEqual([]);
  } finally { moderation.reset(); vi.unstubAllGlobals(); vi.resetModules(); }
});

it('確認変更で実行前queueの旧取得も失効し送信やcooldownを作らない', async () => {
  const { handler, deps, values } = setup();
  await handler.handle(open, popup);
  const entered = deferred(); const release = deferred<string | undefined>();
  deps.readApiKey.mockImplementationOnce(() => { entered.resolve(); return release.promise; });
  const first = handler.handle({ type: 'youtube.resolve', requestId: 'first', videoId: open.videoId }, monitor);
  await entered.promise;
  const queued = handler.handle({ type: 'youtube.resolve', requestId: 'queued', videoId: open.videoId }, monitor);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await handler.confirmationChanged(); release.resolve('fixture-key');
  expect(await first).toEqual(failure('aborted')); expect(await queued).toEqual(failure('aborted'));
  expect(deps.client.resolveVideo).not.toHaveBeenCalled();
  expect(values['youtube.cooldown']).toBeUndefined();
});

it('monitor初期化のstopCollectionと並行する表示専用statusは有効なbindingを返す', async () => {
  const { handler, deps } = setup();
  const moderation = createModeration({ client: createJevClient(vi.fn()), readKey: async () => 'synthetic' });
  const next = createYouTubeHandler({ ...deps, moderation });
  await handler.handle(open, popup);
  const entered = deferred(); const release = deferred();
  deps.tabs.get.mockImplementationOnce(async id => {
    entered.resolve(); await release.promise; return { id, url: 'https://www.youtube.com/watch?v=abcdefghijk' };
  });
  const status = next.handle({ type: 'youtube.status' }, monitor);
  await entered.promise;
  expect(await next.handle({ type: 'jev.stopCollection' }, monitor)).toEqual({ ok: true });
  release.resolve();
  expect(await status).toMatchObject({ ok: true, value: { videoId: open.videoId, credentialsAvailable: true } });
});

it('確認変更はJev enable内部のキー待ちとJev評価queueも失効させる', async () => {
  const { deps } = setup();
  const entered = deferred(); const release = deferred<string | undefined>();
  const readKey = vi.fn(async () => 'synthetic' as string | undefined);
  const fetcher = vi.fn(async () => new Response(JSON.stringify(apiResponse())));
  const moderation = createModeration({ client: createJevClient(fetcher), readKey });
  const handler = createYouTubeHandler({ ...deps, moderation });
  await handler.handle(open, popup);
  readKey.mockImplementationOnce(() => { entered.resolve(); return release.promise; });
  const enabling = handler.handle({ type: 'jev.enable' }, monitor);
  await entered.promise; await handler.confirmationChanged(); release.resolve('synthetic');
  expect(await enabling).toEqual(failure('aborted'));
  moderation.observe([chatPost('no-auto-enable')]); await moderation.evaluate('no-auto-enable');
  expect(fetcher).not.toHaveBeenCalled();
  expect(await handler.handle({ type: 'jev.enable' }, monitor)).toEqual({ ok: true });
  const evaluating = deferred(); const finish = deferred<string | undefined>();
  readKey.mockImplementationOnce(() => { evaluating.resolve(); return finish.promise; });
  moderation.observe([chatPost('first', 1), chatPost('queued', 2)]);
  const first = handler.handle({ type: 'jev.evaluate', id: 'first' }, monitor);
  await evaluating.promise;
  const queued = handler.handle({ type: 'jev.evaluate', id: 'queued' }, monitor);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await handler.confirmationChanged(); finish.resolve('synthetic');
  expect(await first).toEqual(failure('aborted')); expect(await queued).toEqual(failure('aborted'));
  expect(fetcher).not.toHaveBeenCalled(); moderation.reset();
});

it('遅い取得中の201件目は直列キューへ蓄積せず即時失敗する', async () => {
  const { handler, deps } = setup();
  await handler.handle(open, popup);
  const waiting = deferred(); const response = deferred<unknown>();
  deps.client.resolveVideo.mockImplementationOnce(() => { waiting.resolve(); return response.promise; });
  const first = handler.handle({ type: 'youtube.resolve', requestId: 'first', videoId: open.videoId }, monitor);
  await waiting.promise;
  const requests = Array.from({ length: 200 }, (_, i) => handler.handle({ type: 'youtube.resolve', requestId: `waiting-${i}`, videoId: open.videoId }, monitor));
  const result = await Promise.race([requests.at(-1), new Promise(resolve => setTimeout(() => resolve('blocked'), 20))]);
  response.resolve({ ok: true, value: { liveChatId: 'chat-1' } }); await first; await Promise.all(requests);
  expect(result).toMatchObject({ ok: false });
});
it('観測ID期限切れ後の遅延評価は非表示登録しない（永続IDは保持）', async () => {
  const { deps, advance } = setup();
  const hiddenAuthors = createHiddenAuthors({ storage: deps.session, initialize: deps.initialize });
  const moderation = createModeration({ client: createJevClient(vi.fn()), readKey: async () => 'synthetic', now: deps.now });
  const waiting = deferred(); const response = deferred<Awaited<ReturnType<typeof moderation.evaluate>>>();
  vi.spyOn(moderation, 'evaluate').mockImplementationOnce(() => { waiting.resolve(); return response.promise; });
  const handler = createYouTubeHandler({ ...deps, moderation, hiddenAuthors });
  const author = 'UCabcdefghijklmnopqrstuv'; const existing = 'UCzyxwvutsrqponmlkjihgfe';
  await handler.handle(open, popup);
  await hiddenAuthors.add(open.videoId, existing, 0);
  await handler.handle({ type: 'youtube.resolve', requestId: 'resolve', videoId: open.videoId }, monitor); advance(5000);
  deps.client.listMessages.mockResolvedValue({ ok: true, value: { messages: [{ ...chatPost('expiring'), authorChannelId: author }], nextPageToken: 'next', pollingIntervalMillis: 8000, ended: false } });
  await handler.handle({ type: 'youtube.list', requestId: 'list', liveChatId: 'chat-1' }, monitor);
  const evaluation = handler.handle({ type: 'jev.evaluate', id: 'expiring' }, monitor); await waiting.promise;
  advance(60001);
  response.resolve({ ok: true, value: { id: 'expiring', authorChannelId: author, burst: 'confirmed', jev: 'disabled', malicious: true, reasons: ['burst'] } });
  await evaluation;
  expect(await hiddenAuthors.list(open.videoId)).toEqual([existing]);
  moderation.reset();
});
it('公式取得とJev確定だけを配信別登録し、解除済みの同じ結果で再登録しない', async () => {
  const { deps, advance } = setup();
  const hiddenAuthors = createHiddenAuthors({ storage: deps.session, initialize: deps.initialize });
  const moderation = createModeration({ client: createJevClient(async () => new Response(JSON.stringify(apiResponse({ attack: 0.8 })))), readKey: async () => 'synthetic' });
  const handler = createYouTubeHandler({ ...deps, moderation, hiddenAuthors });
  await handler.handle(open, popup);
  await handler.handle({ type: 'jev.enable' }, monitor);
  await handler.handle({ type: 'youtube.resolve', requestId: 'r1', videoId: open.videoId }, monitor);
  advance(5000);
  const author = 'UCabcdefghijklmnopqrstuv';
  deps.client.listMessages.mockResolvedValue({ ok: true, value: { messages: [{ ...chatPost('actual'), authorChannelId: author, authorDisplayName: 'みどり' }], nextPageToken: 'next', pollingIntervalMillis: 8000, ended: false } });
  await handler.handle({ type: 'youtube.list', requestId: 'r2', liveChatId: 'chat-1' }, monitor);
  expect(await hiddenAuthors.list(open.videoId)).toEqual([]);
  await handler.handle({ type: 'jev.evaluate', id: 'actual' }, monitor);
  expect(await hiddenAuthors.list(open.videoId)).toEqual([author]);
  expect(await hiddenAuthors.listAuthors(open.videoId)).toEqual([{ authorChannelId: author, displayName: 'みどり' }]);
  await hiddenAuthors.remove(open.videoId, author);
  await handler.handle({ type: 'jev.evaluate', id: 'actual' }, monitor);
  expect(await hiddenAuthors.list(open.videoId)).toEqual([]);
  advance(8000);
  deps.client.listMessages.mockResolvedValue({ ok: true, value: { messages: [{ ...chatPost('new', 9000), authorChannelId: author, authorDisplayName: 'みどりの庭' }], nextPageToken: 'next2', pollingIntervalMillis: 8000, ended: false } });
  await handler.handle({ type: 'youtube.list', requestId: 'r3', liveChatId: 'chat-1' }, monitor);
  await handler.handle({ type: 'jev.evaluate', id: 'new' }, monitor);
  expect(await hiddenAuthors.list(open.videoId)).toEqual([author]);
  expect(await hiddenAuthors.listAuthors(open.videoId)).toEqual([{ authorChannelId: author, displayName: 'みどりの庭' }]);
});
it('遅い判定中に既取得の名前が変わっても登録には最新観測名を使い、古いcached判定は名前を戻さない', async () => {
  const { deps, advance } = setup();
  const hiddenAuthors = createHiddenAuthors({ storage: deps.session, initialize: deps.initialize });
  const waiting = deferred(); const response = deferred<Response>();
  const moderation = createModeration({ client: createJevClient(async () => { waiting.resolve(); return response.promise; }), readKey: async () => 'synthetic' });
  const handler = createYouTubeHandler({ ...deps, moderation, hiddenAuthors });
  const author = 'UCabcdefghijklmnopqrstuv';
  await handler.handle(open, popup); await handler.handle({ type: 'jev.enable' }, monitor);
  await handler.handle({ type: 'youtube.resolve', requestId: 'resolve', videoId: open.videoId }, monitor);
  async function list(id: string, authorDisplayName?: string) {
    advance(8000);
    deps.client.listMessages.mockResolvedValue({ ok: true, value: { messages: [{ ...chatPost(id), authorChannelId: author, authorDisplayName }], nextPageToken: id, pollingIntervalMillis: 8000, ended: false } });
    expect(await handler.handle({ type: 'youtube.list', requestId: id, liveChatId: 'chat-1' }, monitor)).toMatchObject({ ok: true });
  }
  await list('old', 'みどり');
  const evaluation = handler.handle({ type: 'jev.evaluate', id: 'old' }, monitor); await waiting.promise;
  await list('new', 'みどりの庭');
  // A repeated message can carry a newly acquired name; identity/revision stay fixed.
  await list('old', 'みどりの小道');
  response.resolve(new Response(JSON.stringify(apiResponse({ attack: 1 })))); await evaluation;
  expect(await hiddenAuthors.listAuthors(open.videoId)).toEqual([{ authorChannelId: author, displayName: 'みどりの小道' }]);
  await list('changed', 'みどりの森');
  await handler.handle({ type: 'jev.evaluate', id: 'old' }, monitor);
  await list('missing');
  expect(await hiddenAuthors.listAuthors(open.videoId)).toEqual([{ authorChannelId: author, displayName: 'みどりの森' }]);
  await hiddenAuthors.remove(open.videoId, author);
  await handler.handle({ type: 'jev.evaluate', id: 'old' }, monitor);
  expect(await hiddenAuthors.listAuthors(open.videoId)).toEqual([]);
  moderation.reset();
});
it('Jev未有効化でも取得済み10秒10件のローカル連投を直ちに非表示登録する', async () => {
  const { deps, advance } = setup();
  const hiddenAuthors = createHiddenAuthors({ storage: deps.session, initialize: deps.initialize });
  const fetcher = vi.fn();
  const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic' });
  const handler = createYouTubeHandler({ ...deps, moderation, hiddenAuthors });
  await handler.handle(open, popup);
  await handler.handle({ type: 'youtube.resolve', requestId: 'r1', videoId: open.videoId }, monitor);
  advance(5000);
  const author = 'UCabcdefghijklmnopqrstuv';
  deps.client.listMessages.mockResolvedValue({ ok: true, value: { messages: Array.from({ length: 10 }, (_, n) => ({ ...chatPost(`burst-${n}`, n * 1000), authorChannelId: author, authorDisplayName: 'さくら' })), nextPageToken: 'next', pollingIntervalMillis: 8000, ended: false } });
  await handler.handle({ type: 'youtube.list', requestId: 'r2', liveChatId: 'chat-1' }, monitor);
  expect(await hiddenAuthors.list(open.videoId)).toEqual([author]);
  expect(fetcher).not.toHaveBeenCalled();
  expect(await hiddenAuthors.listAuthors(open.videoId)).toEqual([{ authorChannelId: author, displayName: 'さくら' }]);
});
it('exact bindingだけがJevを有効化でき実list由来IDのみ評価、本文payloadは禁止', async () => {
  const { deps, advance } = setup();
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(apiResponse({ attack: 0.8 }))));
  const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic-jev' });
  const handler = createYouTubeHandler({ ...deps, moderation });
  await handler.handle(open, popup);
  for (const sender of [popup, { ...monitor, id: 'other' }, { ...monitor, url: `${monitor.url}?fake=1` }, { ...monitor, tab: { id: 11 } }])
    expect(await handler.handle({ type: 'jev.enable' }, sender)).toEqual(failure('forbidden'));
  expect(await handler.handle({ type: 'jev.enable' }, monitor)).toEqual({ ok: true });
  expect(await handler.handle({ type: 'jev.evaluate', id: 'forged' }, monitor)).toMatchObject({ ok: false });
  await handler.handle({ type: 'youtube.resolve', requestId: 'r1', videoId: open.videoId }, monitor);
  advance(5000);
  deps.client.listMessages.mockResolvedValue({ ok: true, value: { messages: [chatPost('actual')], nextPageToken: 'next', pollingIntervalMillis: 8000, ended: false } });
  await handler.handle({ type: 'youtube.list', requestId: 'r2', liveChatId: 'chat-1' }, monitor);
  expect(await handler.handle({ type: 'jev.evaluate', id: 'actual', text: 'forged' }, monitor)).toMatchObject({ ok: false });
  expect(await handler.handle({ type: 'jev.evaluate', id: 'actual' }, monitor)).toMatchObject({ ok: true, value: { id: 'actual', malicious: true } });
  expect(fetcher).toHaveBeenCalledTimes(1);
  await handler.targetChanged(9);
  expect(await handler.handle({ type: 'jev.evaluate', id: 'actual' }, monitor)).toMatchObject({ ok: false });
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

it('stopCollection成功後はcancel未配送でも停止前の遅延listを観測・非表示登録せず既存非表示を維持する', async () => {
  const { deps, advance } = setup();
  const hiddenAuthors = createHiddenAuthors({ storage: deps.session, initialize: deps.initialize });
  const fetcher = vi.fn();
  const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic' });
  const observe = vi.spyOn(moderation, 'observe');
  const handler = createYouTubeHandler({ ...deps, moderation, hiddenAuthors });
  const existingAuthor = 'UCabcdefghijklmnopqrstuv';
  const lateAuthor = 'UCzyxwvutsrqponmlkjihgfe';
  await handler.handle(open, popup);
  await hiddenAuthors.add(open.videoId, existingAuthor, 0, () => true, 'みどり');
  await handler.handle({ type: 'youtube.resolve', requestId: 'resolve-before-stop', videoId: open.videoId }, monitor);
  advance(5000);
  const waiting = deferred();
  const response = deferred<unknown>();
  deps.client.listMessages.mockImplementationOnce(() => { waiting.resolve(); return response.promise; });
  const request = handler.handle({ type: 'youtube.list', requestId: 'list-before-stop', liveChatId: 'chat-1' }, monitor);
  await waiting.promise;
  expect(await handler.handle({ type: 'jev.stopCollection' }, monitor)).toEqual({ ok: true });
  // Deliberately deliver no youtube.cancel: stop itself must invalidate this response.
  expect((deps.client.listMessages.mock.calls[0][3] as AbortSignal).aborted).toBe(false);
  response.resolve({ ok: true, value: {
    messages: [{ ...chatPost('late-rename'), authorChannelId: existingAuthor, authorDisplayName: '停止後の古い処理の名前' },
      ...Array.from({ length: 10 }, (_, n) => ({ ...chatPost(`late-burst-${n}`, n * 1000), authorChannelId: lateAuthor, authorDisplayName: 'さくら' }))],
    nextPageToken: 'next', pollingIntervalMillis: 8000, ended: false,
  } });
  const result = await request;
  expect(await hiddenAuthors.list(open.videoId)).toEqual([existingAuthor]);
  expect(await hiddenAuthors.listAuthors(open.videoId)).toEqual([{ authorChannelId: existingAuthor, displayName: 'みどり' }]);
  expect(observe).not.toHaveBeenCalled();
  expect(await moderation.evaluate('late-burst-9')).toEqual({ ok: false, error: { code: 'forbidden' } });
  expect(result).toEqual(failure('aborted'));
  expect(fetcher).not.toHaveBeenCalled();
});

it.each(['stop', 'credentials', 'target', 'remove'] as const)('Jev遅延中の%s後に古い確定結果で登録しない', async action => {
  const { deps, advance } = setup();
  const hiddenAuthors = createHiddenAuthors({ storage: deps.session, initialize: deps.initialize });
  const waiting = deferred(); const response = deferred<Response>();
  const moderation = createModeration({ client: createJevClient(async () => { waiting.resolve(); return response.promise; }), readKey: async () => 'synthetic' });
  const handler = createYouTubeHandler({ ...deps, moderation, hiddenAuthors });
  const author = 'UCabcdefghijklmnopqrstuv';
  await handler.handle(open, popup); await handler.handle({ type: 'jev.enable' }, monitor);
  await handler.handle({ type: 'youtube.resolve', requestId: 'r1', videoId: open.videoId }, monitor); advance(5000);
  deps.client.listMessages.mockResolvedValue({ ok: true, value: { messages: [{ ...chatPost('late'), authorChannelId: author }], nextPageToken: 'next', pollingIntervalMillis: 8000, ended: false } });
  await handler.handle({ type: 'youtube.list', requestId: 'r2', liveChatId: 'chat-1' }, monitor);
  const evaluation = handler.handle({ type: 'jev.evaluate', id: 'late' }, monitor); await waiting.promise;
  if (action === 'stop') await handler.handle({ type: 'jev.stopCollection' }, monitor);
  if (action === 'credentials') await handler.credentialsChanged();
  if (action === 'target') { deps.tabs.get.mockImplementation(async id => ({ id, url: id === 9 ? 'https://www.youtube.com/watch?v=zyxwvutsrqp' : monitor.url })); await handler.targetChanged(9, 'https://www.youtube.com/watch?v=zyxwvutsrqp'); }
  if (action === 'remove') await hiddenAuthors.remove(open.videoId, author);
  response.resolve(new Response(JSON.stringify(apiResponse({ attack: 1 })))); await evaluation;
  expect(await hiddenAuthors.list(open.videoId)).toEqual([]);
  expect(await hiddenAuthors.list('zyxwvutsrqp')).toEqual([]);
});

it.each([
  ['youtube.status', undefined], ['youtube.status', 'https://www.youtube.com/watch?v=aaaaaaaaaaa'],
  ['youtube.cancel', undefined], ['youtube.cancel', 'https://www.youtube.com/watch?v=aaaaaaaaaaa'],
] as const)('旧Aの%s snapshot解放後のAイベント(%s)はBのJev許可・履歴・結果を消さない', async (type, oldUrl) => {
  const { deps, values, advance } = setup();
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(apiResponse({ attack: 0.8 }))));
  const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic-jev' });
  const handler = createYouTubeHandler({ ...deps, moderation });
  await handler.handle(open, popup);
  const readingA = deferred();
  const releaseA = deferred();
  deps.session.get.mockImplementationOnce(async keys => {
    const snapshot = Object.fromEntries(keys.map(key => [key, values[key]]));
    readingA.resolve();
    await releaseA.promise;
    return snapshot;
  });
  const oldRequest = handler.handle({ type, requestId: 'old-A-request' }, monitor);
  await readingA.promise;
  deps.tabs.get.mockImplementation(async id => ({ id, url: id === 11
    ? 'https://www.youtube.com/watch?v=zyxwvutsrqp'
    : id === 9 ? 'https://www.youtube.com/watch?v=abcdefghijk' : monitor.url }));
  await handler.handle({ ...open, tabId: 11, videoId: 'zyxwvutsrqp' }, popup);
  expect(await handler.handle({ type: 'jev.enable' }, monitor)).toEqual({ ok: true });
  await handler.handle({ type: 'youtube.resolve', requestId: 'B-resolve', videoId: 'zyxwvutsrqp' }, monitor);
  advance(5000);
  deps.client.listMessages.mockResolvedValue({ ok: true, value: {
    messages: [chatPost('B-history')], nextPageToken: 'next', pollingIntervalMillis: 8000, ended: false,
  } });
  await handler.handle({ type: 'youtube.list', requestId: 'B-first', liveChatId: 'chat-1' }, monitor);
  const previousResult = await handler.handle({ type: 'jev.evaluate', id: 'B-history' }, monitor);
  expect(previousResult).toMatchObject({ ok: true, value: { jev: 'evaluated' } });
  releaseA.resolve();
  const staleResponse = await oldRequest;
  deps.runtime.sendMessage.mockClear();
  await handler.targetChanged(9, oldUrl);
  expect(deps.runtime.sendMessage).not.toHaveBeenCalled();
  expect(await handler.handle({ type: 'jev.evaluate', id: 'B-history' }, monitor)).toEqual(previousResult);
  expect(fetcher).toHaveBeenCalledTimes(1);
  advance(8000);
  deps.client.listMessages.mockResolvedValue({ ok: true, value: {
    messages: [chatPost('B-new', 1000)], nextPageToken: 'next-2', pollingIntervalMillis: 8000, ended: false,
  } });
  await handler.handle({ type: 'youtube.list', requestId: 'B-next', liveChatId: 'chat-1' }, monitor);
  expect(await handler.handle({ type: 'jev.evaluate', id: 'B-new' }, monitor)).toMatchObject({ ok: true, value: { jev: 'evaluated' } });
  expect(fetcher).toHaveBeenCalledTimes(2);
  const body = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(body.state.history).toEqual([{ text: chatPost('B-history').text, publishedAt: chatPost('B-history').publishedAt }]);
  expect(staleResponse).toEqual(failure('aborted'));
});

it('対象照合待ちの古いJev有効化要求は新bindingへ外部送信の許可を持ち越さない', async () => {
  const { deps } = setup();
  const readKey = vi.fn(async () => 'synthetic');
  const moderation = createModeration({ client: createJevClient(vi.fn()), readKey });
  const handler = createYouTubeHandler({ ...deps, moderation });
  await handler.handle(open, popup);
  const checking = deferred(); const finish = deferred<{ id: number; url: string }>();
  deps.tabs.get.mockImplementationOnce(() => { checking.resolve(); return finish.promise; });
  const oldEnable = handler.handle({ type: 'jev.enable' }, monitor);
  await checking.promise;
  await handler.handle(open, popup);
  finish.resolve({ id: 9, url: 'https://www.youtube.com/watch?v=abcdefghijk' });
  expect(await oldEnable).toEqual(failure('aborted'));
  expect(readKey).not.toHaveBeenCalled();
});
it('新binding書込の完了時にもJev世代を切り替え旧monitorから途中で来たenableを失効させる', async () => {
  const { deps, values } = setup();
  const moderation = createModeration({ client: createJevClient(vi.fn()), readKey: async () => 'synthetic' });
  const handler = createYouTubeHandler({ ...deps, moderation });
  await handler.handle(open, popup);
  const writing = deferred(); const commit = deferred();
  deps.session.set.mockImplementationOnce(async data => { writing.resolve(); await commit.promise; Object.assign(values, data); });
  const newOpen = handler.handle(open, popup);
  await writing.promise;
  await handler.handle({ type: 'jev.enable' }, monitor);
  commit.resolve(); await newOpen;
  moderation.observe([chatPost('new-session')]);
  expect(await moderation.evaluate('new-session')).toMatchObject({ ok: true, value: { jev: 'disabled' } });
});

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
