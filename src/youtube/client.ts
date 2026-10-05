import { failure, type ChatMessage, type ChatPage, type Result, type YouTubeClient } from './contracts';
import { publicationTime } from './published-at';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function resolveVideo(body: unknown, videoId: string): Result<{ liveChatId: string }> {
  if (!record(body) || !Array.isArray(body.items)) return failure('invalidResponse');
  if (body.items.length === 0) return failure('notFound');
  if (body.items.length !== 1 || !record(body.items[0]) || body.items[0].id !== videoId) return failure('invalidResponse');
  const details = body.items[0].liveStreamingDetails;
  if (details === undefined) return failure('notLive');
  if (!record(details)) return failure('invalidResponse');
  for (const field of ['actualStartTime', 'actualEndTime', 'scheduledStartTime']) {
    if (details[field] !== undefined && (!nonempty(details[field]) || !Number.isFinite(Date.parse(details[field])))) return failure('invalidResponse');
  }
  if (details.activeLiveChatId !== undefined && !nonempty(details.activeLiveChatId)) return failure('invalidResponse');
  if (details.actualEndTime !== undefined) return failure('ended');
  if (nonempty(details.activeLiveChatId)) return { ok: true, value: { liveChatId: details.activeLiveChatId } };
  return failure(details.actualStartTime !== undefined ? 'chatDisabled' : 'notLive');
}

function parsePage(body: unknown): Result<ChatPage> {
  if (!record(body) || !nonempty(body.nextPageToken) || !Number.isSafeInteger(body.pollingIntervalMillis)
    || typeof body.pollingIntervalMillis !== 'number' || body.pollingIntervalMillis <= 0 || !Array.isArray(body.items)) return failure('invalidResponse');
  if (body.offlineAt !== undefined && (!nonempty(body.offlineAt) || !Number.isFinite(Date.parse(body.offlineAt)))) return failure('invalidResponse');
  let ended = body.offlineAt !== undefined;
  const messages: ChatMessage[] = [];
  for (const item of body.items) {
    if (!record(item) || !nonempty(item.id) || !record(item.snippet) || !nonempty(item.snippet.type)
      || typeof item.snippet.hasDisplayContent !== 'boolean') return failure('invalidResponse');
    const snippet = item.snippet;
    if (snippet.type === 'chatEndedEvent') ended = true;
    if (snippet.hasDisplayContent === false) continue;
    if (typeof snippet.displayMessage !== 'string' || !record(item.authorDetails) || !nonempty(item.authorDetails.channelId)) return failure('invalidResponse');
    messages.push({ id: item.id, text: snippet.displayMessage, type: snippet.type as string, authorChannelId: item.authorDetails.channelId,
      ...(publicationTime(snippet.publishedAt) === undefined ? {} : { publishedAt: snippet.publishedAt as string }) });
  }
  return { ok: true, value: { messages, nextPageToken: body.nextPageToken, pollingIntervalMillis: body.pollingIntervalMillis, ended } };
}

function httpFailure(status: number, body: unknown, retryAfter: string | null) {
  const reasons = record(body) && record(body.error) && Array.isArray(body.error.errors)
    ? body.error.errors.filter(record).map(error => error.reason) : [];
  if (record(body) && record(body.error) && Array.isArray(body.error.details)) {
    reasons.push(...body.error.details.filter(record).filter(detail => detail['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo').map(detail => detail.reason));
  }
  if (reasons.includes('liveChatDisabled')) return failure('chatDisabled');
  if (reasons.includes('liveChatEnded')) return failure('ended');
  if (status === 404 || reasons.includes('liveChatNotFound') || reasons.includes('videoNotFound')) return failure('notFound');
  if (reasons.some(reason => ['quotaExceeded', 'dailyLimitExceeded', 'dailyLimitExceededUnreg'].includes(String(reason)))) return failure('quota');
  if (status === 401 || reasons.some(reason => ['keyInvalid', 'accessNotConfigured', 'ipRefererBlocked', 'authError', 'API_KEY_INVALID', 'API_KEY_SERVICE_BLOCKED', 'API_KEY_HTTP_REFERRER_BLOCKED'].includes(String(reason)))) return failure('auth');
  let delay: number | undefined;
  if (retryAfter !== null) {
    const parsed = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(parsed) && parsed >= 0) delay = parsed;
  }
  if (status === 429 || reasons.includes('rateLimitExceeded') || reasons.includes('userRateLimitExceeded')) return failure('rateLimited', delay);
  if (status >= 500) return failure('unavailable', status === 503 ? delay : undefined);
  return failure(status === 403 ? 'forbidden' : 'api');
}

export function createYouTubeClient(fetcher: typeof fetch = fetch): YouTubeClient {
  async function request<T>(path: string, params: Record<string, string>, apiKey: string, signal: AbortSignal,
    parse: (body: unknown) => Result<T>): Promise<Result<T>> {
    if (signal.aborted) return failure('aborted');
    if (!nonempty(apiKey)) return failure('auth');
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    url.search = new URLSearchParams({ ...params, key: apiKey }).toString();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 20000);
    try {
      const response = await fetcher(url.toString(), { signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error' });
      let body: unknown;
      try { body = await response.json(); } catch {
        return signal.aborted ? failure('aborted') : controller.signal.aborted ? failure('network') : response.ok ? failure('invalidResponse') : httpFailure(response.status, undefined, response.headers.get('Retry-After'));
      }
      if (signal.aborted) return failure('aborted');
      return response.ok ? parse(body) : httpFailure(response.status, body, response.headers.get('Retry-After'));
    } catch {
      return failure(signal.aborted ? 'aborted' : 'network');
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }
  }
  return {
    async resolveVideo(videoId: string, apiKey: string, signal: AbortSignal) {
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return failure('invalidInput');
      return request('videos', { id: videoId, part: 'liveStreamingDetails' }, apiKey, signal, body => resolveVideo(body, videoId));
    },
    async listMessages(liveChatId, pageToken, apiKey, signal): Promise<Result<ChatPage>> {
      if (!nonempty(liveChatId) || (pageToken !== undefined && !nonempty(pageToken))) return failure('invalidInput');
      return request('liveChat/messages', { liveChatId, part: 'id,snippet,authorDetails',
        ...(pageToken === undefined ? {} : { pageToken }) }, apiKey, signal, parsePage);
    },
  };
}
