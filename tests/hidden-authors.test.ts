import { expect, it, vi } from 'vitest';
import { createHiddenAuthors } from '../src/hidden-authors/store';

it('API確認済み動画のscopeだけを再起動後に復元し、再解決の失効と全削除で消す', async () => {
  const video = 'abcdefghijk'; const channel = 'UC0000000000000000000000'; const values: Record<string, unknown> = {};
  const storage = { get: async (keys: string[] | null) => keys === null ? structuredClone(values) : Object.fromEntries(keys.map(key => [key, structuredClone(values[key])])),
    set: async (data: Record<string, unknown>) => { Object.assign(values, structuredClone(data)); },
    remove: async (keys: string[]) => { for (const key of keys) delete values[key]; } };
  const store = createHiddenAuthors({ storage, initialize: async () => {} });
  expect(await store.channelForVideo(video)).toBeUndefined();
  await store.rememberVideo(video, channel);
  const restarted = createHiddenAuthors({ storage, initialize: async () => {} });
  expect(await restarted.channelForVideo(video)).toBe(channel);
  expect(await restarted.channelForVideo('zyxwvutsrqp')).toBeUndefined();
  expect(values[`hiddenAuthors.channel.${channel}`]).toBeUndefined();
  await restarted.forgetVideo(video); expect(await restarted.channelForVideo(video)).toBeUndefined();
  await restarted.rememberVideo(video, channel); await restarted.clearAll(); expect(values).toEqual({});
});

it('scope cacheの未保存成功/読戻し失敗は成功にせず、不正な保存IDも復元しない', async () => {
  const channel = 'UC0000000000000000000000'; const values: Record<string, unknown> = {};
  const storage = { get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map(key => [key, values[key]]))),
    set: vi.fn(async (data: Record<string, unknown>) => { Object.assign(values, data); }), remove: async () => {} };
  const store = createHiddenAuthors({ storage, initialize: async () => {} });
  storage.set.mockResolvedValueOnce(undefined);
  await expect(store.rememberVideo('abcdefghijk', channel)).rejects.toThrow();
  expect(await store.channelForVideo('abcdefghijk')).toBeUndefined();
  storage.get.mockRejectedValueOnce(new Error('synthetic'));
  await expect(store.rememberVideo('abcdefghijk', channel)).rejects.toThrow();
  values['hiddenAuthors.scope.abcdefghijk'] = 'invalid';
  await expect(store.channelForVideo('abcdefghijk')).rejects.toThrow();
});

it('並行する旧動画移行・新規登録・解除を直列化し、無関係な旧revisionの大小で現状態を上書きしない', async () => {
  const channel = 'UC0000000000000000000000'; const x = 'UCabcdefghijklmnopqrstuv'; const y = 'UCzyxwvutsrqponmlkjihgfe'; const z = 'UC2222222222222222222222';
  const values: Record<string, unknown> = { 'hiddenAuthors.abcdefghijk': { ids: [x], revisions: { [x]: 99, [y]: 88 } },
    'hiddenAuthors.zyxwvutsrqp': { ids: [z], revisions: {} } };
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(done => { enter = done; }); const gate = new Promise<void>(done => { release = done; });
  const storage = { get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map(key => [key, structuredClone(values[key])]))),
    set: async (data: Record<string, unknown>) => { Object.assign(values, structuredClone(data)); },
    remove: async (keys: string[]) => { for (const key of keys) delete values[key]; } };
  const store = createHiddenAuthors({ storage, initialize: async () => {} }); await store.add(channel, y, 0, () => true, '現行登録');
  storage.get.mockImplementationOnce(async keys => { const snapshot = Object.fromEntries(keys.map(key => [key, structuredClone(values[key])])); enter(); await gate; return snapshot; });
  const first = store.migrate('abcdefghijk', channel); await entered;
  const second = store.migrate('zyxwvutsrqp', channel); const remove = store.remove(channel, x);
  release(); await Promise.all([first, second, remove]);
  expect(await store.listAuthors(channel)).toEqual([{ authorChannelId: y, displayName: '現行登録' }, { authorChannelId: z }]);
  expect(await store.revision(channel, x)).toBe(1); expect(await store.revision(channel, y)).toBe(0);
});

it('移行失敗は旧データを保持し、write成功/remove失敗後の解除と再訪で再取り込みしない', async () => {
  const channel = 'UC0000000000000000000000'; const author = 'UCabcdefghijklmnopqrstuv'; const video = 'abcdefghijk';
  const values: Record<string, unknown> = { [`hiddenAuthors.${video}`]: { ids: [author], revisions: {} } };
  const storage = { get: async (keys: string[]) => Object.fromEntries(keys.map(key => [key, structuredClone(values[key])])),
    set: vi.fn(async (data: Record<string, unknown>) => { Object.assign(values, structuredClone(data)); }),
    remove: vi.fn(async (keys: string[]) => { for (const key of keys) delete values[key]; }) };
  const store = createHiddenAuthors({ storage, initialize: async () => {} });
  storage.set.mockRejectedValueOnce(new Error('synthetic'));
  await expect(store.migrate(video, channel)).rejects.toThrow();
  expect(storage.remove).not.toHaveBeenCalled(); expect(values[`hiddenAuthors.${video}`]).toBeDefined();
  storage.remove.mockRejectedValueOnce(new Error('synthetic'));
  await expect(store.migrate(video, channel)).rejects.toThrow();
  await store.remove(channel, author);
  await createHiddenAuthors({ storage, initialize: async () => {} }).migrate(video, channel);
  expect(await store.list(channel)).toEqual([]); expect(values[`hiddenAuthors.${video}`]).toBeUndefined();
  expect((values[`hiddenAuthors.channel.${channel}`] as { migratedVideos: string[] }).migratedVideos).toEqual([video]);
});

it('移行先setが成功応答でも未保存なら旧キーを削除せず、再試行で移行できる', async () => {
  const channel = 'UC0000000000000000000000'; const author = 'UCabcdefghijklmnopqrstuv';
  const values: Record<string, unknown> = { 'hiddenAuthors.abcdefghijk': { ids: [author], revisions: {} } };
  const storage = { get: async (keys: string[]) => Object.fromEntries(keys.map(key => [key, structuredClone(values[key])])),
    set: vi.fn(async (data: Record<string, unknown>) => { Object.assign(values, structuredClone(data)); }),
    remove: vi.fn(async (keys: string[]) => { for (const key of keys) delete values[key]; }) };
  storage.set.mockResolvedValueOnce(undefined);
  const store = createHiddenAuthors({ storage, initialize: async () => {} });
  await expect(store.migrate('abcdefghijk', channel)).rejects.toThrow();
  expect(storage.remove).not.toHaveBeenCalled(); expect(values['hiddenAuthors.abcdefghijk']).toBeDefined();
  await store.migrate('abcdefghijk', channel);
  expect(await store.list(channel)).toEqual([author]); expect(values['hiddenAuthors.abcdefghijk']).toBeUndefined();
});

it('壊れた旧保存は空データへ移行して削除せず、壊れたchannelも空readyへ読み替えない', async () => {
  const channel = 'UC0000000000000000000000'; const values: Record<string, unknown> = { 'hiddenAuthors.abcdefghijk': { revisions: {} } };
  const storage = { get: async (keys: string[]) => Object.fromEntries(keys.map(key => [key, values[key]])),
    set: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
  const store = createHiddenAuthors({ storage, initialize: async () => {} });
  await expect(store.migrate('abcdefghijk', channel)).rejects.toThrow();
  expect(storage.set).not.toHaveBeenCalled(); expect(storage.remove).not.toHaveBeenCalled();
  values[`hiddenAuthors.channel.${channel}`] = { ids: [] };
  await expect(store.list(channel)).rejects.toThrow();
});

it('確認済み動画だけ遅延移行し、別旧動画のXは解除後・再起動後にも復活しない', async () => {
  const channel = 'UC0000000000000000000000'; const author = 'UCabcdefghijklmnopqrstuv';
  const values: Record<string, unknown> = Object.fromEntries(['abcdefghijk', 'zyxwvutsrqp'].map(video =>
    [`hiddenAuthors.${video}`, { ids: [author], revisions: {}, displayNames: { [author]: 'みどり' } }]));
  const storage = { get: async (keys: string[] | null) => keys === null ? structuredClone(values)
    : Object.fromEntries(keys.map(key => [key, structuredClone(values[key])])),
    set: async (data: Record<string, unknown>) => { Object.assign(values, structuredClone(data)); },
    remove: async (keys: string[]) => { for (const key of keys) delete values[key]; } };
  const store = createHiddenAuthors({ storage, initialize: async () => {} });
  await store.migrate('abcdefghijk', channel);
  expect(await store.list(channel)).toEqual([author]);
  expect(values['hiddenAuthors.zyxwvutsrqp']).toBeDefined();
  await store.remove(channel, author);
  const restarted = createHiddenAuthors({ storage, initialize: async () => {} });
  await restarted.migrate('zyxwvutsrqp', channel);
  expect(await restarted.list(channel)).toEqual([]);
  await restarted.add(channel, author, 0);
  expect(await restarted.list(channel)).toEqual([]);
  await restarted.add(channel, author, await restarted.revision(channel, author), () => true, '新しい名前');
  expect(await restarted.listAuthors(channel)).toEqual([{ authorChannelId: author, displayName: '新しい名前' }]);
  const state = values[`hiddenAuthors.channel.${channel}`] as { migratedVideos: string[] };
  expect(state.migratedVideos).toEqual(['abcdefghijk', 'zyxwvutsrqp']);
  await restarted.migrate('00000000000', channel);
  expect((values[`hiddenAuthors.channel.${channel}`] as typeof state).migratedVideos).toEqual(state.migratedVideos);
});

it('同名別IDを別々に永続化し、ID-only legacyのrevisionとIDを読取で書き換えない', async () => {
  const video = 'UC0000000000000000000000'; const a = 'UCabcdefghijklmnopqrstuv'; const b = 'UCzyxwvutsrqponmlkjihgfe';
  const values: Record<string, unknown> = { [`hiddenAuthors.channel.${video}`]: { ids: [a], revisions: { [a]: 3 } } };
  const storage = { get: async () => structuredClone(values), set: vi.fn(async (v: Record<string, unknown>) => { Object.assign(values, structuredClone(v)); }) };
  const store = createHiddenAuthors({ storage, initialize: async () => {} });
  expect(await store.listAuthors(video)).toEqual([{ authorChannelId: a }]);
  expect(storage.set).not.toHaveBeenCalled();
  await store.add(video, b, 0, () => true, 'みどり');
  await store.updateDisplayName(video, a, 3, 'みどり');
  expect(await createHiddenAuthors({ storage, initialize: async () => {} }).listAuthors(video))
    .toEqual([{ authorChannelId: a, displayName: 'みどり' }, { authorChannelId: b, displayName: 'みどり' }]);
  await store.remove(video, a);
  expect(await store.list(video)).toEqual([b]);
  expect(await store.revision(video, a)).toBe(4);
  await store.add(video, a, 3, () => true, '古い名前');
  await store.updateDisplayName(video, a, 3, '古い名前');
  expect(await store.listAuthors(video)).toEqual([{ authorChannelId: b, displayName: 'みどり' }]);
  expect(values[`hiddenAuthors.channel.${video}`]).toEqual({ ids: [b], revisions: { [a]: 4 }, displayNames: { [b]: 'みどり' } });
});

it('非表示IDを制限せず、storage待ちの201操作目だけを即時拒否する', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const store = createHiddenAuthors({ initialize: () => gate, storage: { get: async () => ({}), set: async () => {} } });
  const requests = Array.from({ length: 201 }, () => store.list('UC0000000000000000000000').catch(() => 'rejected'));
  const result = await Promise.race([requests.at(-1), new Promise(resolve => setTimeout(() => resolve('blocked'), 20))]);
  release(); await Promise.all(requests);
  expect(result).toBe('rejected');
});

it('名前更新のstorage読取待ちに世代失効・解除が起きても名前もIDも復活させない', async () => {
  const video = 'UC0000000000000000000000'; const author = 'UCabcdefghijklmnopqrstuv';
  const values: Record<string, unknown> = {};
  let hold = false; let entered!: () => void; let release!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const storage = { get: async () => { const snapshot = structuredClone(values); if (hold) { entered(); await gate; } return snapshot; },
    set: vi.fn(async (v: Record<string, unknown>) => { Object.assign(values, structuredClone(v)); }) };
  const store = createHiddenAuthors({ storage, initialize: async () => {} });
  await store.add(video, author, 0, () => true, 'みどり'); storage.set.mockClear();
  hold = true; let current = true;
  const update = store.updateDisplayName(video, author, 0, '古い処理の名前', () => current);
  await reading; const remove = store.remove(video, author); current = false; hold = false; release();
  await update; await remove;
  expect(storage.set).toHaveBeenCalledTimes(1);
  expect(await store.listAuthors(video)).toEqual([]);
  await store.updateDisplayName(video, author, 0, '古い名前');
  await store.add(video, author, 1, () => true, '新しい名前');
  await store.updateDisplayName(video, author, 0, '古い名前');
  await store.add(video, author, 1, () => true, '古いcached判定の名前');
  expect(await store.listAuthors(video)).toEqual([{ authorChannelId: author, displayName: '新しい名前' }]);
});

it.each([undefined, null, [], { UCabcdefghijklmnopqrstuv: 123 }, { UCabcdefghijklmnopqrstuv: '' }, { UCabcdefghijklmnopqrstuv: '  ' }])(
  'legacy/不正な名前metadata %j でも非表示IDとrevisionを失わない', async displayNames => {
    const video = 'UC0000000000000000000000'; const author = 'UCabcdefghijklmnopqrstuv';
    const storage = { get: async () => ({ [`hiddenAuthors.channel.${video}`]: { ids: [author], revisions: { [author]: 9 }, displayNames } }), set: vi.fn(async () => {}) };
    const store = createHiddenAuthors({ storage, initialize: async () => {} });
    expect(await store.listAuthors(video)).toEqual([{ authorChannelId: author }]);
    expect(await store.revision(video, author)).toBe(9); expect(storage.set).not.toHaveBeenCalled();
  });

it('非表示IDは一時データの10000件制限を適用せず全件維持する', async () => {
  const video = 'UC0000000000000000000000'; const ids = Array.from({ length: 10001 }, (_, n) => `UC${String(n).padStart(22, '0')}`);
  const storage = { get: async () => ({ [`hiddenAuthors.channel.${video}`]: { ids, revisions: {} } }), set: vi.fn(async () => {}) };
  const store = createHiddenAuthors({ storage, initialize: async () => {} });
  expect(await store.list(video)).toEqual(ids); expect(await store.listAuthors(video)).toHaveLength(10001);
  expect(storage.set).not.toHaveBeenCalled();
});

it('配信別local永続を再起動後も読み、解除で古い判定を無効化し新規観測だけ再登録できる', async () => {
  const module = await import('../src/hidden-authors/store').catch(() => ({}));
  expect(module).toHaveProperty('createHiddenAuthors');
  if (!('createHiddenAuthors' in module)) return;
  const values: Record<string, unknown> = {};
  const storage = {
    get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map(key => [key, structuredClone(values[key])]))),
    set: vi.fn(async (data: Record<string, unknown>) => { Object.assign(values, structuredClone(data)); }),
  };
  const initialize = vi.fn(async () => {});
  const store = module.createHiddenAuthors({ storage, initialize });
  const video = 'UC0000000000000000000000'; const author = 'UCabcdefghijklmnopqrstuv';
  const revision = await store.revision(video, author);
  await store.add(video, author, revision);
  expect(await store.list(video)).toEqual([author]);
  expect(await store.list('UC1111111111111111111111')).toEqual([]);
  const restarted = module.createHiddenAuthors({ storage, initialize });
  expect(await restarted.list(video)).toEqual([author]);
  await restarted.remove(video, author);
  expect(await restarted.list(video)).toEqual([]);
  await restarted.add(video, author, revision);
  expect(await restarted.list(video)).toEqual([]);
  await restarted.add(video, author, await restarted.revision(video, author));
  expect(await restarted.list(video)).toEqual([author]);
  expect(initialize).toHaveBeenCalled();
});
