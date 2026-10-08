import { expect, it, vi } from 'vitest';
import { createHiddenAuthors } from '../src/hidden-authors/store';
import type { MessageSender } from '../src/extension-runtime';
import { createHiddenAuthorHandler } from '../src/hidden-authors/handler';

it('全削除はexact optionsの単一payloadだけ許可し、失敗/秘密を成功応答にしない', async () => {
  const clearAll = vi.fn(async () => {});
  const storage = { get: async () => ({}), set: async () => {} };
  const handler = createHiddenAuthorHandler({ store: createHiddenAuthors({ storage, initialize: async () => {} }),
    tabs: { get: async () => ({}) }, session: storage, runtime: { id: 'test', getURL: p => `chrome-extension://test/${p}` }, clearAll });
  const options = { id: 'test', url: 'chrome-extension://test/options.html' };
  for (const sender of [{ ...options, id: 'other' }, { ...options, url: `${options.url}?x=1` },
    { ...options, url: `${options.url}#x` }, { ...options, url: 'chrome-extension://test/popup.html' },
    { ...options, url: 'chrome-extension://test/monitor.html' }, { ...options, url: 'https://www.youtube.com/live_chat' }, { id: 'test' }])
    expect(await handler.handle({ type: 'hidden.clearAll' }, sender)).toEqual({ ok: false });
  expect(await handler.handle({ type: 'hidden.clearAll', body: 'synthetic-private' }, options)).toEqual({ ok: false });
  expect(clearAll).not.toHaveBeenCalled();
  expect(await handler.handle({ type: 'hidden.clearAll' }, options)).toEqual({ ok: true });
  clearAll.mockRejectedValueOnce(new Error('synthetic-private'));
  expect(await handler.handle({ type: 'hidden.clearAll' }, options)).toEqual({ ok: false });
});

it('全削除前に受信しbinding読取待ちだった個別解除は空revision項目を復活させない', async () => {
  const videoId = 'abcdefghijk'; const author = 'UCabcdefghijklmnopqrstuv';
  const values: Record<string, unknown> = { [`hiddenAuthors.${videoId}`]: { ids: [author], revisions: {} } };
  const storage = { get: async (keys: string[] | null) => keys === null ? structuredClone(values) : Object.fromEntries(keys.map(k => [k, values[k]])),
    set: async (v: Record<string, unknown>) => { Object.assign(values, v); }, remove: async (keys: string[]) => { for (const k of keys) delete values[k]; } };
  const store = createHiddenAuthors({ storage, initialize: async () => {} });
  let release!: () => void; let enter!: () => void;
  const gate = new Promise<void>(done => { release = done; }); const entered = new Promise<void>(done => { enter = done; });
  const handler = createHiddenAuthorHandler({ store, session: { get: async () => { enter(); await gate; return { 'youtube.monitorBinding': { monitorTabId: 10, targetTabId: 9, videoId } }; } },
    tabs: { get: async () => ({ url: `https://www.youtube.com/watch?v=${videoId}` }) }, runtime: { id: 'test', getURL: p => `chrome-extension://test/${p}` }, clearAll: () => store.clearAll() });
  const stale = handler.handle({ type: 'hidden.remove', videoId, authorChannelId: author }, { id: 'test', url: 'chrome-extension://test/monitor.html', tab: { id: 10 } });
  await entered; await store.clearAll(); release(); await stale;
  expect(Object.keys(values)).toEqual([]);
});

it('削除中に受信し認可が削除完了後に返る個別解除も空項目を復活させない', async () => {
  const videoId = 'abcdefghijk'; const author = 'UCabcdefghijklmnopqrstuv';
  const values: Record<string, unknown> = { [`hiddenAuthors.${videoId}`]: { ids: [author], revisions: {} } };
  let removing!: () => void; let removeDone!: () => void; let authorize!: () => void; let entered!: () => void;
  const removingStarted = new Promise<void>(done => { removing = done; }); const removalGate = new Promise<void>(done => { removeDone = done; });
  const authGate = new Promise<void>(done => { authorize = done; }); const authStarted = new Promise<void>(done => { entered = done; });
  const storage = { get: async (keys: string[] | null) => keys === null ? structuredClone(values) : Object.fromEntries(keys.map(k => [k, values[k]])),
    set: async (v: Record<string, unknown>) => { Object.assign(values, v); }, remove: async (keys: string[]) => { removing(); await removalGate; for (const k of keys) delete values[k]; } };
  const store = createHiddenAuthors({ storage, initialize: async () => {} });
  const handler = createHiddenAuthorHandler({ store, session: { get: async () => { entered(); await authGate; return { 'youtube.monitorBinding': { monitorTabId: 10, targetTabId: 9, videoId } }; } },
    tabs: { get: async () => ({ url: `https://www.youtube.com/watch?v=${videoId}` }) }, runtime: { id: 'test', getURL: p => `chrome-extension://test/${p}` } });
  const clear = store.clearAll(); await removingStarted;
  const stale = handler.handle({ type: 'hidden.remove', videoId, authorChannelId: author }, { id: 'test', url: 'chrome-extension://test/monitor.html', tab: { id: 10 } });
  await authStarted; removeDone(); await clear; authorize(); await stale;
  expect(Object.keys(values)).toEqual([]);
});

it('削除完了後に古い一覧の解除ボタンを送っても空revisionを新規保存しない', async () => {
  const videoId = 'abcdefghijk'; const author = 'UCabcdefghijklmnopqrstuv'; const values: Record<string, unknown> = {};
  const storage = { get: async (keys: string[] | null) => keys === null ? structuredClone(values) : Object.fromEntries(keys.map(k => [k, values[k]])),
    set: async (v: Record<string, unknown>) => { Object.assign(values, v); }, remove: async (keys: string[]) => { for (const k of keys) delete values[k]; } };
  const store = createHiddenAuthors({ storage, initialize: async () => {} }); await store.add(videoId, author, 0); await store.clearAll();
  const handler = createHiddenAuthorHandler({ store, session: { get: async () => ({ 'youtube.monitorBinding': { monitorTabId: 10, targetTabId: 9, videoId } }) },
    tabs: { get: async () => ({ url: `https://www.youtube.com/watch?v=${videoId}` }) }, runtime: { id: 'test', getURL: p => `chrome-extension://test/${p}` } });
  expect(await handler.handle({ type: 'hidden.remove', videoId, authorChannelId: author }, { id: 'test', url: 'chrome-extension://test/monitor.html', tab: { id: 10 } }))
    .toEqual({ ok: true, videoId, ids: [], authors: [] });
  expect(Object.keys(values)).toEqual([]);
});

it('binding一致monitorだけへ名前を返しcontentは従来ID-only、名前偽造writeを拒否する', async () => {
  const videoId = 'abcdefghijk'; const author = 'UCabcdefghijklmnopqrstuv';
  const values: Record<string, unknown> = { 'youtube.monitorBinding': { monitorTabId: 10, targetTabId: 9, videoId } };
  const storage = { get: async (keys: string[]) => Object.fromEntries(keys.map(k => [k, values[k]])), set: async (v: Record<string, unknown>) => { Object.assign(values, v); } };
  const store = createHiddenAuthors({ storage, initialize: async () => {} });
  await store.add(videoId, author, 0, () => true, 'みどり');
  const handler = createHiddenAuthorHandler({ store, session: storage, tabs: { get: async () => ({ url: `https://www.youtube.com/watch?v=${videoId}` }) },
    runtime: { id: 'test', getURL: p => `chrome-extension://test/${p}` } });
  const monitor = { id: 'test', url: 'chrome-extension://test/monitor.html', tab: { id: 10 } };
  expect(await handler.handle({ type: 'hidden.list', videoId }, monitor))
    .toEqual({ ok: true, videoId, ids: [author], authors: [{ authorChannelId: author, displayName: 'みどり' }] });
  const content = { id: 'test', url: `https://www.youtube.com/live_chat?v=${videoId}`, tab: { id: 9 } };
  expect(await handler.handle({ type: 'hidden.list', videoId, referrer: '' }, content)).toEqual({ ok: true, videoId, ids: [author] });
  for (const sender of [monitor, content]) {
    expect(await handler.handle({ type: 'hidden.add', videoId, authorChannelId: author, displayName: '偽造' }, sender)).toEqual({ ok: false });
    expect(await handler.handle({ type: 'hidden.remove', videoId, authorChannelId: author, displayName: '偽造' }, sender)).toEqual({ ok: false });
  }
  expect(await handler.handle({ type: 'hidden.remove', videoId, authorChannelId: author }, monitor))
    .toEqual({ ok: true, videoId, ids: [], authors: [] });
});

it('contentへ対象videoのIDsだけを返し外部・他URL・別video・解除payloadを拒否する', async () => {
  const module = await import('../src/hidden-authors/handler').catch(() => ({}));
  expect(module).toHaveProperty('createHiddenAuthorHandler');
  if (!('createHiddenAuthorHandler' in module)) return;
  const values: Record<string, unknown> = {};
  const storage = { get: async (keys: string[]) => Object.fromEntries(keys.map(k => [k, values[k]])), set: async (v: Record<string, unknown>) => { Object.assign(values,v); } };
  const store = createHiddenAuthors({ storage, initialize: async () => {} });
  const author = 'UCabcdefghijklmnopqrstuv'; const videoId = 'abcdefghijk';
  await store.add(videoId, author, 0);
  const tabs = { get: vi.fn(async () => ({ url: `https://www.youtube.com/watch?v=${videoId}` })) };
  const handler = module.createHiddenAuthorHandler({ store, tabs, session: storage, runtime: { id:'test', getURL:(p:string)=>`chrome-extension://test/${p}` } });
  const sender = { id:'test', url:'https://www.youtube.com/live_chat?continuation=opaque', tab:{id:9}, frameId:1 };
  const message = {type:'hidden.list',videoId,referrer:`https://www.youtube.com/watch?v=${videoId}`};
  expect(await handler.handle(message,sender)).toEqual({ok:true,videoId,ids:[author]});
  const invalid: [unknown, MessageSender][] = [[message,{...sender,id:'other'}],[message,{...sender,url:'https://evil.example/live_chat'}],[{...message,videoId:'zyxwvutsrqp'},sender],[{...message,type:'hidden.remove',authorChannelId:author},sender],[{...message,key:'please'},sender]];
  for(const [m,s] of invalid){
    expect(await handler.handle(m,s)).toEqual({ok:false});
  }
});
