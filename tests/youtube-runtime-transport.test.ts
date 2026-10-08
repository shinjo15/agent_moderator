import { expect, it, vi } from 'vitest';
const { sendMessage } = vi.hoisted(() => ({ sendMessage: vi.fn() }));
vi.mock('../src/extension-runtime', () => ({ runtime: { sendMessage } }));
import { createRuntimeTransport } from '../src/youtube/runtime-transport';
const message = { id: 'post', text: 'こんにちは', type: 'textMessageEvent', authorChannelId: 'UCabcdefghijklmnopqrstuv' };
const page = { messages: [message], nextPageToken: 'next', pollingIntervalMillis: 5000, ended: false };
it.each([{ ...page, messages: [null] }, { ...page, messages: [{}] }, { ...page, messages: undefined }])('IPCの壊れたlist %j はUIへ流さない', async value => {
  sendMessage.mockResolvedValueOnce({ ok: true, value });
  expect(await createRuntimeTransport().listMessages('chat', undefined, new AbortController().signal))
    .toMatchObject({ ok: false, error: { code: 'invalidResponse' } });
});
