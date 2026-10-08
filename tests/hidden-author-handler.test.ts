import { expect, it, vi } from 'vitest';
import { createHiddenAuthors } from '../src/hidden-authors/store';
import type { MessageSender } from '../src/extension-runtime';
import { createHiddenAuthorHandler } from '../src/hidden-authors/handler';

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
