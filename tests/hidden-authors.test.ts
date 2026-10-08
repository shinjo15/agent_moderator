import { expect, it, vi } from 'vitest';
import { createHiddenAuthors } from '../src/hidden-authors/store';

it('同名別IDを別々に永続化し、ID-only legacyのrevisionとIDを読取で書き換えない', async () => {
  const video = 'abcdefghijk'; const a = 'UCabcdefghijklmnopqrstuv'; const b = 'UCzyxwvutsrqponmlkjihgfe';
  const values: Record<string, unknown> = { [`hiddenAuthors.${video}`]: { ids: [a], revisions: { [a]: 3 } } };
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
  expect(values[`hiddenAuthors.${video}`]).toEqual({ ids: [b], revisions: { [a]: 4 }, displayNames: { [b]: 'みどり' } });
});

it('非表示IDを制限せず、storage待ちの201操作目だけを即時拒否する', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const store = createHiddenAuthors({ initialize: () => gate, storage: { get: async () => ({}), set: async () => {} } });
  const requests = Array.from({ length: 201 }, () => store.list('abcdefghijk').catch(() => 'rejected'));
  const result = await Promise.race([requests.at(-1), new Promise(resolve => setTimeout(() => resolve('blocked'), 20))]);
  release(); await Promise.all(requests);
  expect(result).toBe('rejected');
});

it('名前更新のstorage読取待ちに世代失効・解除が起きても名前もIDも復活させない', async () => {
  const video = 'abcdefghijk'; const author = 'UCabcdefghijklmnopqrstuv';
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
    const video = 'abcdefghijk'; const author = 'UCabcdefghijklmnopqrstuv';
    const storage = { get: async () => ({ [`hiddenAuthors.${video}`]: { ids: [author], revisions: { [author]: 9 }, displayNames } }), set: vi.fn(async () => {}) };
    const store = createHiddenAuthors({ storage, initialize: async () => {} });
    expect(await store.listAuthors(video)).toEqual([{ authorChannelId: author }]);
    expect(await store.revision(video, author)).toBe(9); expect(storage.set).not.toHaveBeenCalled();
  });

it('非表示IDは一時データの10000件制限を適用せず全件維持する', async () => {
  const video = 'abcdefghijk'; const ids = Array.from({ length: 10001 }, (_, n) => `UC${String(n).padStart(22, '0')}`);
  const storage = { get: async () => ({ [`hiddenAuthors.${video}`]: { ids, revisions: {} } }), set: vi.fn(async () => {}) };
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
  const video = 'abcdefghijk'; const author = 'UCabcdefghijklmnopqrstuv';
  const revision = await store.revision(video, author);
  await store.add(video, author, revision);
  expect(await store.list(video)).toEqual([author]);
  expect(await store.list('zyxwvutsrqp')).toEqual([]);
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
