import { expect, it, vi } from 'vitest';
import { createHiddenAuthors } from '../src/hidden-authors/store';
import { CONFIRMATION_VERSION } from '../src/confirmation';
const video = 'UC0000000000000000000000'; const author = 'UCabcdefghijklmnopqrstuv';
function fixture() {
  const values: Record<string, unknown> = {
    [`hiddenAuthors.channel.${video}`]: { ids: [author], displayNames: { [author]: '名前' }, revisions: {}, migratedVideos: ['abcdefghijk'],
      triggerComments: { [author]: { text: '削除対象の登録時本文', videoId: 'abcdefghijk' } } },
    'hiddenAuthors.zyxwvutsrqp': { ids: [], revisions: { [author]: 3 } },
    'apiKey.youtube': 'synthetic', 'apiKey.jev': 'synthetic', 'moderation.threshold': 0.8,
    'youtube.cooldown': { notBefore: 99999 }, 'usage.confirmation': { version: CONFIRMATION_VERSION }, unrelated: true,
  };
  const storage = { get: vi.fn(async (_keys: string[] | null) => structuredClone(values)),
    set: vi.fn(async (data: Record<string, unknown>) => { Object.assign(values, structuredClone(data)); }),
    remove: vi.fn(async (keys: string[]) => { for (const key of keys) delete values[key]; }) };
  return { values, storage, store: createHiddenAuthors({ storage, initialize: async () => {} }) };
}
it('全配信の空/legacy/revision/nameを全件削除し他localを保持、再起動でも復活しない', async () => {
  const { values, storage, store } = fixture();
  for (let n = 0; n < 1001; n++) values[`hiddenAuthors.${String(n).padStart(11, '0')}`] = {};
  await store.clearAll();
  expect(Object.keys(values).some(key => key.startsWith('hiddenAuthors.'))).toBe(false);
  expect(values).toEqual({ 'apiKey.youtube': 'synthetic', 'apiKey.jev': 'synthetic', 'moderation.threshold': 0.8, 'youtube.cooldown': { notBefore: 99999 }, 'usage.confirmation': { version: CONFIRMATION_VERSION }, unrelated: true });
  expect(await createHiddenAuthors({ storage, initialize: async () => {} }).list(video)).toEqual([]);
  await store.add(video, author, 0, () => true, '新規');
  expect(await store.listAuthors(video)).toEqual([{ authorChannelId: author, displayName: '新規' }]);
});
it.each(['reject', 'noop'] as const)('削除%sはreadback確認なしで成功しない', async failure => {
  const { store, storage } = fixture();
  storage.remove.mockImplementation(async () => { if (failure === 'reject') throw new Error('synthetic'); });
  await expect(store.clearAll()).rejects.toThrow();
});
it.each(['add', 'updateDisplayName', 'remove'] as const)('storage読取待ちとqueueの%sは削除epochを跨いで書き戻さない', async operation => {
  const { values, storage, store } = fixture();
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(done => { enter = done; }); const gate = new Promise<void>(done => { release = done; });
  storage.get.mockImplementationOnce(async () => { const snapshot = structuredClone(values); enter(); await gate; return snapshot; });
  const first = operation === 'add' ? store.add(video, author, 0, () => true, undefined, { text: '古い本文', videoId: 'abcdefghijk' }) : operation === 'remove' ? store.remove(video, author) : store.updateDisplayName(video, author, 0, '古い名前');
  await entered;
  const queued = store.add('UC1111111111111111111111', author, 0);
  const clear = store.clearAll(); release();
  await Promise.all([first, queued, clear]);
  expect(storage.set).not.toHaveBeenCalled();
  expect(Object.keys(values).some(key => key.startsWith('hiddenAuthors.'))).toBe(false);
});
it.each(['read', 'write'] as const)('遅延移行%sと解除/addが全削除に競合しても新旧metadataを復活させない', async phase => {
  const { values, storage, store } = fixture();
  values[`hiddenAuthors.channel.${video}`] = { ids: [], revisions: {} };
  values['hiddenAuthors.abcdefghijk'] = { ids: [author], revisions: {} };
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(done => { enter = done; }); const gate = new Promise<void>(done => { release = done; });
  if (phase === 'read') storage.get.mockImplementationOnce(async () => { const snapshot = structuredClone(values); enter(); await gate; return snapshot; });
  else storage.set.mockImplementationOnce(async data => { enter(); await gate; Object.assign(values, data); });
  const migrate = store.migrate('abcdefghijk', video); await entered;
  const remove = store.remove(video, author); const add = store.add(video, author, 0); const clear = store.clearAll();
  release(); await Promise.all([migrate, remove, add, clear]);
  expect(Object.keys(values).some(key => key.startsWith('hiddenAuthors.'))).toBe(false);
});

it('scope cacheの実行中setとqueued保存は全削除後に対応を復活させない', async () => {
  const { values, storage, store } = fixture();
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(done => { enter = done; }); const gate = new Promise<void>(done => { release = done; });
  storage.set.mockImplementationOnce(async data => { enter(); await gate; Object.assign(values, data); });
  const first = store.rememberVideo('abcdefghijk', video); await entered;
  const queued = store.rememberVideo('zyxwvutsrqp', video); const clear = store.clearAll(); release();
  await Promise.all([first, queued, clear]);
  expect(await createHiddenAuthors({ storage, initialize: async () => {} }).channelForVideo('abcdefghijk')).toBeUndefined();
  expect(Object.keys(values).some(key => key.startsWith('hiddenAuthors.'))).toBe(false);
});

it('実行中setは完了後に削除し、成功後に古いwriteが残らない', async () => {
  const { values, storage, store } = fixture();
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(done => { enter = done; }); const gate = new Promise<void>(done => { release = done; });
  storage.set.mockImplementationOnce(async data => { enter(); await gate; Object.assign(values, data); });
  const write = store.updateDisplayName(video, author, 0, '遅い名前'); await entered;
  const clear = store.clearAll(); release(); await Promise.all([write, clear]);
  expect(Object.keys(values).some(key => key.startsWith('hiddenAuthors.'))).toBe(false);
});
