import { expect, it } from 'vitest';
import { createHiddenAuthorSnapshot } from '../src/hidden-authors/snapshot';
const video = 'abcdefghijk'; const author = 'UCabcdefghijklmnopqrstuv';
const snapshot = (ids = [author]) => ({ ok: true, videoId: video, ids });

it('配信者未解決は空readyにせず表示保留し、確定後の保存一覧だけで表示を許可する', async () => {
  let result: unknown = { ok: false, code: 'scopeUnresolved' };
  const view = createHiddenAuthorSnapshot({ read: async () => result, changed() {} });
  await view.setVideo(video);
  expect(view.state().status).toBe('loading'); expect(view.visible('other')).toBe(false);
  result = snapshot(); await view.refresh();
  expect(view.state().status).toBe('ready'); expect(view.visible(author)).toBe(false);
  result = { ok: false, code: 'scopeUnresolved' }; await view.poll();
  expect(view.state().status).toBe('loading'); expect(view.visible('other')).toBe(false);
});
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>(done => { resolve = done; }); return { promise, resolve }; }
it('初回読取前と読取失敗時は本文を表示せず、再試行で保存IDを反映する', async () => {
  const first = deferred(); let result: unknown = first.promise;
  const view = createHiddenAuthorSnapshot({ read: async () => result, changed() {} });
  const selecting = view.setVideo(video);
  expect(view.visible(author)).toBe(false); expect(view.visible('other')).toBe(false);
  first.resolve(snapshot()); await selecting;
  expect(view.visible(author)).toBe(false); expect(view.visible('other')).toBe(true);
  result = { ok: false }; await view.refresh();
  expect(view.state().status).toBe('error'); expect(view.visible('other')).toBe(false);
  result = snapshot([]); await view.refresh(); expect(view.visible(author)).toBe(true);
});
it('定期読取は正常表示を点滅させず重複せず、明示再読取は古いsnapshotを失効する', async () => {
  const late = deferred(); let result: unknown = snapshot([]); let calls = 0;
  const view = createHiddenAuthorSnapshot({ read: async () => { calls++; return result; }, changed() {} });
  await view.setVideo(video); result = late.promise;
  const poll = view.poll(); void view.poll();
  expect(view.visible(author)).toBe(true); expect(calls).toBe(2);
  const explicit = view.refresh();
  expect(view.visible(author)).toBe(true);
  result = snapshot(); await view.refresh(); expect(view.visible(author)).toBe(false);
  late.resolve(snapshot([])); await poll; await explicit; expect(view.visible(author)).toBe(false);
});
it('対象切替後の初期応答と解除前の遅延snapshotは表示を上書きしない', async () => {
  const old = deferred(); let result: unknown = old.promise;
  const view = createHiddenAuthorSnapshot({ read: async () => result, changed() {} });
  const initial = view.setVideo(video);
  await view.setVideo(undefined); old.resolve(snapshot([])); await initial;
  expect(view.visible(author)).toBe(false);
  result = snapshot(); await view.setVideo(video);
  const beforeRemove = deferred(); result = beforeRemove.promise; const pending = view.refresh();
  result = snapshot([]); await view.refresh(); beforeRemove.resolve(snapshot()); await pending;
  expect(view.visible(author)).toBe(true);
});
