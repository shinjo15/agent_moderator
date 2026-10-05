import { expect, it, vi } from 'vitest';
import { createHiddenAuthors } from '../src/hidden-authors/store';
import type { MessageSender } from '../src/extension-runtime';

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
