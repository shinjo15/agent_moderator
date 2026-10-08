import { expect, it, vi } from 'vitest';
const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('../src/extension-runtime', () => ({ runtime: { sendMessage } }));
import { createRuntimeTransport } from '../src/youtube/runtime-transport';
const message = { id: 'post', text: 'こんにちは', type: 'textMessageEvent', authorChannelId: 'UCabcdefghijklmnopqrstuv' };
const page = { messages: [message], nextPageToken: 'next', pollingIntervalMillis: 5000, ended: false };
it.each([undefined, 'みどり', '<img src=x onerror=alert(1)>', 'さくら'.repeat(1000)])('IPCの取得済み名前 %s はIDと共存しそのまま伝播する', async authorDisplayName => {
  const value = { ...page, messages: [{ ...message, ...(authorDisplayName === undefined ? {} : { authorDisplayName }) }] };
  sendMessage.mockResolvedValueOnce({ ok: true, value });
  expect(await createRuntimeTransport().listMessages('chat', undefined, new AbortController().signal)).toEqual({ ok: true, value });
});
it.each([null, 123, {}, '', '  '])('IPCの不正名 %j はUIへ流さず固定invalidResponseにする', async authorDisplayName => {
  sendMessage.mockResolvedValueOnce({ ok: true, value: { ...page, messages: [{ ...message, authorDisplayName }] } });
  expect(await createRuntimeTransport().listMessages('chat', undefined, new AbortController().signal))
    .toMatchObject({ ok: false, error: { code: 'invalidResponse' } });
});
it.each([{ ...page, messages: [null] }, { ...page, messages: [{}] }, { ...page, messages: undefined }])('IPCの壊れたlist %j はUIへ流さない', async value => {
  sendMessage.mockResolvedValueOnce({ ok: true, value });
  expect(await createRuntimeTransport().listMessages('chat', undefined, new AbortController().signal))
    .toMatchObject({ ok: false, error: { code: 'invalidResponse' } });
});
