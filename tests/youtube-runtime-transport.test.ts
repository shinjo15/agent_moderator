import { expect, it, vi } from 'vitest';
const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('../src/extension-runtime', () => ({ runtime: { sendMessage } }));
import { createRuntimeTransport } from '../src/youtube/runtime-transport';
const message = { id: 'post', text: 'こんにちは', type: 'textMessageEvent', authorChannelId: 'UCabcdefghijklmnopqrstuv' };
const page = { messages: [message], nextPageToken: 'next', pollingIntervalMillis: 5000, ended: false };
it.each(['https://yt3.ggpht.com/channel=s88-c', 'https://yt3.googleusercontent.com/ytc/channel=s48-c'])('IPC avatar %s をそのまま伝播する', async authorProfileImageUrl => {
  const value = { ...page, messages: [{ ...message, authorProfileImageUrl }] };
  sendMessage.mockResolvedValueOnce({ ok: true, value });
  expect(await createRuntimeTransport().listMessages('chat', undefined, new AbortController().signal)).toEqual({ ok: true, value });
});
it.each([undefined, null, 123, '', 'javascript:alert(1)', 'data:image/png;base64,AA', 'http://yt3.ggpht.com/a',
  'https://user:pass@yt3.ggpht.com/a', 'https://yt3.ggpht.com.evil.invalid/a', 'https://localhost/a',
  'https://yt3.googleusercontent.com.evil.invalid/a', 'https://yt3.ggpht.com:8443/a', 'https://yt3.ggpht.com/a?key=synthetic',
  ' https://yt3.ggpht.com/a', 'https://yt3.ggpht.com\\@evil.invalid/a',
])('IPC改竄avatar %j だけを落とし本文を維持する', async authorProfileImageUrl => {
  const value = { ...page, messages: [{ ...message, authorProfileImageUrl }] };
  sendMessage.mockResolvedValueOnce({ ok: true, value });
  expect(await createRuntimeTransport().listMessages('chat', undefined, new AbortController().signal)).toEqual({ ok: true, value: page });
  expect(value.messages[0]).toHaveProperty('authorProfileImageUrl', authorProfileImageUrl);
});
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
