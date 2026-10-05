import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createChatMonitor } from '../src/youtube/monitor';
import type { ChatPage, Result } from '../src/youtube/contracts';
import { failure } from '../src/youtube/contracts';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { vi.useRealTimers(); });
const page = (ids: string[], token = 'next-1', interval = 8000): Result<ChatPage> => ({ ok: true, value: {
  messages: ids.map(id => ({ id, text: id, authorChannelId: 'channel-1', type: 'textMessageEvent' })),
  nextPageToken: token, pollingIntervalMillis: interval, ended: false,
} });
function setup() {
  const transport = { resolveVideo: vi.fn().mockResolvedValue({ ok: true, value: { liveChatId: 'chat-1' } }),
    listMessages: vi.fn().mockResolvedValue(page(['m1', 'm1'])) };
  const onMessages = vi.fn();
  const onState = vi.fn();
  const monitor = createChatMonitor({ transport, onMessages, onState, now: () => Date.now() });
  monitor.setVideo('abcdefghijk');
  monitor.credentialsChanged(true);
  return { monitor, transport, onMessages, onState };
}

it('一回ずつ取得しnextPageTokenを継承、指定間隔まで待ち重複IDを返さない', async () => {
  const { monitor, transport, onMessages } = setup();
  monitor.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(transport.resolveVideo).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(transport.listMessages).toHaveBeenCalledTimes(1);
  expect(onMessages.mock.calls[0][0].map((m: { id: string }) => m.id)).toEqual(['m1']);
  transport.listMessages.mockResolvedValue(page(['m1', 'm2'], 'next-2'));
  await vi.advanceTimersByTimeAsync(7999);
  expect(transport.listMessages).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(transport.listMessages).toHaveBeenLastCalledWith('chat-1', 'next-1', expect.any(AbortSignal));
  expect(onMessages.mock.calls[1][0].map((m: { id: string }) => m.id)).toEqual(['m2']);
  monitor.stop();
  await vi.advanceTimersByTimeAsync(60000);
  expect(transport.listMessages).toHaveBeenCalledTimes(2);
});

it('開始連打・停止直後の明示再開でも既定/指定間隔より早くcallしない', async () => {
  const { monitor, transport, onMessages } = setup();
  monitor.start(); monitor.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(transport.resolveVideo).toHaveBeenCalledTimes(1);
  monitor.stop(); monitor.start();
  await vi.advanceTimersByTimeAsync(4999);
  expect(transport.listMessages).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(transport.listMessages).toHaveBeenCalledTimes(1);
  monitor.stop(); monitor.start();
  await vi.advanceTimersByTimeAsync(7999);
  expect(transport.listMessages).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(transport.listMessages).toHaveBeenCalledTimes(2);
  expect(onMessages.mock.calls.flatMap(call => call[0])).toHaveLength(1);
  monitor.stop();
});

it('停止がAbortし、遅延応答は通知せず次取得も開始しない', async () => {
  const { monitor, transport, onMessages } = setup();
  let finish!: (result: Result<ChatPage>) => void;
  transport.listMessages.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  monitor.start();
  await vi.advanceTimersByTimeAsync(5000);
  const signal = transport.listMessages.mock.calls[0][2] as AbortSignal;
  monitor.stop();
  expect(signal.aborted).toBe(true);
  finish(page(['late']));
  await vi.advanceTimersByTimeAsync(60000);
  expect(onMessages).not.toHaveBeenCalled();
  expect(transport.listMessages).toHaveBeenCalledTimes(1);
});

it.each(['rateLimited', 'unavailable', 'network', 'quota', 'auth', 'invalidResponse', 'chatDisabled', 'notFound', 'ended'] as const)
  ('%sでは自動再試行せず停止しRetry-Afterまで明示再開も待つ', async code => {
    const { monitor, transport, onState } = setup();
    transport.listMessages.mockResolvedValue(failure(code, 30000));
    monitor.start();
    await vi.advanceTimersByTimeAsync(5000);
    expect(onState).toHaveBeenLastCalledWith({ status: code === 'ended' ? 'ended' : 'error', error: failure(code, 30000).error });
    await vi.advanceTimersByTimeAsync(10000);
    expect(transport.listMessages).toHaveBeenCalledTimes(1);
    monitor.start();
    await vi.advanceTimersByTimeAsync(19999);
    expect(transport.listMessages).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.listMessages).toHaveBeenCalledTimes(2);
    monitor.stop();
  });

it('動画遷移・キー削除/差替えでAbortし古い応答を隔離、削除後は再開できない', async () => {
  const { monitor, transport, onMessages } = setup();
  let finish!: (result: Result<ChatPage>) => void;
  transport.listMessages.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  monitor.start();
  await vi.advanceTimersByTimeAsync(5000);
  monitor.credentialsChanged(false);
  expect((transport.listMessages.mock.calls[0][2] as AbortSignal).aborted).toBe(true);
  monitor.start();
  finish(page(['late'], 'old-token', 15000));
  await vi.advanceTimersByTimeAsync(60000);
  expect(onMessages).not.toHaveBeenCalled();
  expect(transport.listMessages).toHaveBeenCalledTimes(1);
  monitor.credentialsChanged(true);
  monitor.setVideo('zyxwvutsrqp');
  monitor.start();
  await vi.advanceTimersByTimeAsync(15000);
  expect(transport.resolveVideo).toHaveBeenLastCalledWith('zyxwvutsrqp', expect.any(AbortSignal));
  expect(transport.listMessages).toHaveBeenCalledTimes(2);
  expect(transport.listMessages).toHaveBeenLastCalledWith('chat-1', undefined, expect.any(AbortSignal));
  monitor.stop();
});

it('遅延応答の完了まで再開後も並行callしない、古いサーバー間隔も保持する', async () => {
  const { monitor, transport, onMessages } = setup();
  let finish!: (result: Result<ChatPage>) => void;
  transport.listMessages.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  monitor.start();
  await vi.advanceTimersByTimeAsync(5000);
  monitor.stop(); monitor.setVideo('zyxwvutsrqp'); monitor.start();
  await vi.advanceTimersByTimeAsync(60000);
  expect(transport.resolveVideo).toHaveBeenCalledTimes(1);
  finish(page(['stale'], 'stale-token', 20000));
  await vi.advanceTimersByTimeAsync(19999);
  expect(transport.resolveVideo).toHaveBeenCalledTimes(1);
  expect(onMessages).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(transport.resolveVideo).toHaveBeenCalledTimes(2);
  monitor.stop();
});

it('動画ID欠落/不正時は開始せず、resolveエラー・throwでも停止する', async () => {
  const { monitor, transport, onState } = setup();
  monitor.setVideo(undefined);
  monitor.start();
  await vi.advanceTimersByTimeAsync(10000);
  expect(transport.resolveVideo).not.toHaveBeenCalled();
  monitor.setVideo('invalid'); monitor.start();
  await vi.advanceTimersByTimeAsync(10000);
  expect(transport.resolveVideo).not.toHaveBeenCalled();
  monitor.setVideo('abcdefghijk');
  transport.resolveVideo.mockResolvedValueOnce(failure('notLive'));
  monitor.start();
  await vi.advanceTimersByTimeAsync(10000);
  expect(onState).toHaveBeenLastCalledWith({ status: 'error', error: failure('notLive').error });
  expect(transport.listMessages).not.toHaveBeenCalled();
  transport.resolveVideo.mockRejectedValueOnce(new Error('secret https://secret.invalid'));
  monitor.start();
  await vi.advanceTimersByTimeAsync(10000);
  expect(onState).toHaveBeenLastCalledWith({ status: 'error', error: failure('network').error });
});

it('正常応答でもendedなら最終メッセージ通知後に継続取得を止める', async () => {
  const { monitor, transport, onState, onMessages } = setup();
  transport.listMessages.mockResolvedValue({ ok: true, value: { ...(page(['final']) as { ok: true; value: ChatPage }).value, ended: true } });
  monitor.start();
  await vi.advanceTimersByTimeAsync(60000);
  expect(transport.listMessages).toHaveBeenCalledTimes(1);
  expect(onMessages).toHaveBeenCalledTimes(1);
  expect(onState).toHaveBeenLastCalledWith({ status: 'ended' });
});

it('キー差替えで同じ動画を再解決しても既処理IDは重複通知しない', async () => {
  const { monitor, transport, onMessages } = setup();
  monitor.start();
  await vi.advanceTimersByTimeAsync(5000);
  monitor.credentialsChanged(true);
  monitor.start();
  await vi.advanceTimersByTimeAsync(7999);
  expect(transport.resolveVideo).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(8001);
  expect(transport.resolveVideo).toHaveBeenCalledTimes(2);
  expect(transport.listMessages).toHaveBeenCalledTimes(2);
  expect(onMessages).toHaveBeenCalledTimes(1);
  monitor.stop();
});

it('タイマーの最大遅延を超える指定でも短縮せずchunkして待機する', async () => {
  const { monitor, transport } = setup();
  transport.listMessages.mockResolvedValue(page([], 'next', 2147483647 + 10000));
  monitor.start();
  await vi.advanceTimersByTimeAsync(5000);
  await vi.advanceTimersByTimeAsync(2147483647);
  expect(transport.listMessages).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(9999);
  expect(transport.listMessages).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(transport.listMessages).toHaveBeenCalledTimes(2);
  monitor.stop();
});

it('エラー後の明示再開も直近pollingIntervalMillisより早くcallしない', async () => {
  const { monitor, transport } = setup();
  monitor.start();
  await vi.advanceTimersByTimeAsync(5000);
  transport.listMessages.mockResolvedValueOnce(failure('network'));
  await vi.advanceTimersByTimeAsync(8000);
  expect(transport.listMessages).toHaveBeenCalledTimes(2);
  monitor.start();
  await vi.advanceTimersByTimeAsync(7999);
  expect(transport.listMessages).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(transport.listMessages).toHaveBeenCalledTimes(3);
  monitor.stop();
});
