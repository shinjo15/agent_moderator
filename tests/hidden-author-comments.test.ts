import { expect, it, vi } from 'vitest';
import { createHiddenAuthors } from '../src/hidden-authors/store';
import { createHiddenAuthorSnapshot } from '../src/hidden-authors/snapshot';
const channel = 'UC0000000000000000000000';
const author = 'UCabcdefghijklmnopqrstuv';
const videoId = 'abcdefghijk';
function fixture(initial: Record<string, unknown> = {}) {
  const values = structuredClone(initial);
  const storage = {
    get: async (keys: string[] | null) => keys === null ? structuredClone(values) : Object.fromEntries(keys.map(key => [key, structuredClone(values[key])])),
    set: vi.fn(async (data: Record<string, unknown>) => { Object.assign(values, structuredClone(data)); }),
    remove: async (keys: string[]) => { for (const key of keys) delete values[key]; },
  };
  return { values, storage, store: createHiddenAuthors({ storage, initialize: async () => {} }) };
}
it('最初の登録本文を長さ制限せず保存し、後続・改名・別動画で上書きせず再起動後も保持する', async () => {
  const { store, storage } = fixture();
  const triggerComment = { text: '登録時\n<img src=x onerror=alert(1)>' + '長い本文😀'.repeat(2000), videoId };
  await store.add(channel, author, 0, () => true, '名前', triggerComment);
  await store.add(channel, author, 0, () => true, '別名', { text: '後続', videoId: 'zyxwvutsrqp' });
  await store.updateDisplayName(channel, author, 0, '改名');
  expect(await createHiddenAuthors({ storage, initialize: async () => {} }).listAuthors(channel))
    .toEqual([{ authorChannelId: author, displayName: '改名', triggerComment }]);
});
it('空本文は欠落と区別し、解除で本文を削除、新規登録だけ新本文を保存できる', async () => {
  const { store, values } = fixture();
  await store.add(channel, author, 0, () => true, undefined, { text: '', videoId });
  expect(await store.listAuthors(channel)).toEqual([{ authorChannelId: author, triggerComment: { text: '', videoId } }]);
  await store.remove(channel, author);
  expect(JSON.stringify(values)).not.toContain('triggerComment');
  await store.add(channel, author, 0, () => true, undefined, { text: '古い結果', videoId });
  expect(await store.listAuthors(channel)).toEqual([]);
  await store.add(channel, author, 1, () => true, undefined, { text: '新規', videoId });
  expect(await store.listAuthors(channel)).toEqual([{ authorChannelId: author, triggerComment: { text: '新規', videoId } }]);
  await store.clearAll(); expect(values).toEqual({});
});
it('既存本文なしと不正metadataは後続追加で埋めず、IDと解除世代を維持する', async () => {
  const { store, storage } = fixture({ [`hiddenAuthors.channel.${channel}`]: {
    ids: [author], revisions: { [author]: 2 }, triggerComments: { [author]: { text: 123, videoId } },
  } });
  expect(await store.listAuthors(channel)).toEqual([{ authorChannelId: author }]);
  await store.add(channel, author, 2, () => true, undefined, { text: '根拠でない後続', videoId });
  expect(await store.listAuthors(channel)).toEqual([{ authorChannelId: author }]);
  expect(await store.revision(channel, author)).toBe(2); expect(storage.set).not.toHaveBeenCalled();
});
it('登録書込失敗後の最初の成功だけが根拠となり、旧移行もその本文を上書きしない', async () => {
  const { store, storage, values } = fixture();
  storage.set.mockRejectedValueOnce(new Error('synthetic'));
  await expect(store.add(channel, author, 0, () => true, undefined, { text: '失敗した本文', videoId })).rejects.toThrow();
  expect(await store.listAuthors(channel)).toEqual([]);
  const triggerComment = { text: '成功した本文', videoId: 'zyxwvutsrqp' };
  await store.add(channel, author, 0, () => true, undefined, triggerComment);
  values[`hiddenAuthors.${videoId}`] = { ids: [author], revisions: {}, displayNames: { [author]: '古い名前' } };
  await store.migrate(videoId, channel);
  expect(await store.listAuthors(channel)).toEqual([{ authorChannelId: author, triggerComment }]);
});
it('重複保存IDは人数だけで隠さず不正状態として読取を拒否する', async () => {
  const { store } = fixture({ [`hiddenAuthors.channel.${channel}`]: { ids: [author, author], revisions: {} } });
  await expect(store.listAuthors(channel)).rejects.toThrow();
});
it('snapshotは保存根拠と空本文を伝え、重複IPC IDをreadyにしない', async () => {
  let response: unknown = { ok: true, videoId, ids: [author], authors: [{ authorChannelId: author, triggerComment: { text: '', videoId } }] };
  const view = createHiddenAuthorSnapshot({ read: async () => response, changed() {} });
  await view.setVideo(videoId);
  expect(view.state().authors).toEqual([{ authorChannelId: author, triggerComment: { text: '', videoId } }]);
  response = { ok: true, videoId, ids: [author, author] }; await view.refresh();
  expect(view.state().status).toBe('error');
});
