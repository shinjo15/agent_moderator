import { runtime } from '../extension-runtime';
import { failure, type ChatPage, type Result } from './contracts';
import type { ChatTransport } from './monitor';

export function createRuntimeTransport(): ChatTransport {
  async function request<T>(message: Record<string, unknown>, signal: AbortSignal): Promise<Result<T>> {
    if (signal.aborted) return failure('aborted');
    const requestId = crypto.randomUUID();
    const cancel = () => { void runtime.sendMessage({ type: 'youtube.cancel', requestId }).catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        runtime.sendMessage({ ...message, requestId }),
        new Promise(resolve => { timeout = setTimeout(() => { cancel(); resolve(failure('network')); }, 25000); }),
      ]);
      if (signal.aborted) return failure('aborted');
      if (typeof result !== 'object' || result === null || !('ok' in result) || typeof result.ok !== 'boolean') return failure('invalidResponse');
      return result as Result<T>;
    } catch { return failure(signal.aborted ? 'aborted' : 'network'); }
    finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
  }
  return {
    resolveVideo: (videoId, signal) => request<{ liveChatId: string }>({ type: 'youtube.resolve', videoId }, signal),
    listMessages: (liveChatId, pageToken, signal) => request<ChatPage>({ type: 'youtube.list', liveChatId, pageToken }, signal),
  };
}
