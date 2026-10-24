import { runtime } from '../extension-runtime';
import { failure, validDisplayName, validProfileImageUrl, type ChatPage, type Result } from './contracts';
import type { ChatTransport } from './monitor';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function validPage(value: unknown): value is ChatPage {
  return object(value) && Array.isArray(value.messages) && value.messages.every(message => object(message)
    && typeof message.id === 'string' && message.id.length > 0 && typeof message.text === 'string'
    && typeof message.authorChannelId === 'string' && message.authorChannelId.length > 0
    && typeof message.type === 'string' && message.type.length > 0
    && (message.authorDisplayName === undefined || validDisplayName(message.authorDisplayName)))
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
    startCollection: (videoId, explicit, signal) => request({ type: 'youtube.start', videoId, explicit }, signal),
    async readiness(signal) {
      const result = await request<{ waitMillis?: number }>({ type: 'youtube.status' }, signal);
      if (!result.ok) return result;
      const wait = result.value.waitMillis;
      return { ok: true, value: { waitMillis: typeof wait === 'number' && Number.isFinite(wait) && wait >= 0 ? wait : 0 } };
    },
    resolveVideo: (videoId, signal) => request<{ liveChatId: string; jevEnabled?: boolean }>({ type: 'youtube.resolve', videoId }, signal),
    async listMessages(liveChatId, pageToken, signal) {
      const result = await request<ChatPage>({ type: 'youtube.list', liveChatId, pageToken }, signal);
      if (!result.ok) return result;
      if (!validPage(result.value)) return failure('invalidResponse');
      return { ok: true, value: { ...result.value, messages: result.value.messages.map(message => {
        const { authorProfileImageUrl, ...rest } = message;
        return { ...rest, ...(validProfileImageUrl(authorProfileImageUrl) ? { authorProfileImageUrl } : {}) };
      }) } };
    },
  };
}
