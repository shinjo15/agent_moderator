import { runtime } from '../extension-runtime';
import { failure, type ChatPage, type Result } from './contracts';
import type { ChatTransport } from './monitor';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validPage(value: unknown): value is ChatPage {
  return object(value) && Array.isArray(value.messages) && value.messages.every(message => object(message)
    && typeof message.id === 'string' && message.id.length > 0 && typeof message.text === 'string'
    && typeof message.authorChannelId === 'string' && message.authorChannelId.length > 0
    && typeof message.type === 'string' && message.type.length > 0)
    && typeof value.nextPageToken === 'string' && value.nextPageToken.length > 0
    && typeof value.pollingIntervalMillis === 'number' && Number.isSafeInteger(value.pollingIntervalMillis)
    && value.pollingIntervalMillis > 0 && typeof value.ended === 'boolean';
}

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
    async listMessages(liveChatId, pageToken, signal) {
      const result = await request<ChatPage>({ type: 'youtube.list', liveChatId, pageToken }, signal);
      return result.ok && !validPage(result.value) ? failure('invalidResponse') : result;
    },
  };
}
