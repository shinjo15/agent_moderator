import { failure, type ChatError, type ChatMessage, type ChatPage, type Result } from './contracts';
import { createTransientMap } from '../retention';

// キーはtrusted backgroundだけが扱う。monitorページには取得結果だけが渡る。
export type ChatTransport = {
  startCollection?(videoId: string, explicit: boolean, signal: AbortSignal): Promise<{ ok: true } | { ok: false; error: ChatError }>;
  resolveVideo(videoId: string, signal: AbortSignal): Promise<Result<{ liveChatId: string; jevEnabled?: boolean }>>;
  listMessages(liveChatId: string, pageToken: string | undefined, signal: AbortSignal): Promise<Result<ChatPage>>;
  readiness?(signal: AbortSignal): Promise<Result<{ waitMillis: number }>>;
};
export type MonitorState = { status: 'stopped' | 'running' | 'error' | 'ended'; error?: ChatError };
export const DEFAULT_INTERVAL_MILLIS = 5000;

export function createChatMonitor({ transport, onMessages, onState, onResolved = () => {}, now = () => performance.now() }: {
  transport: ChatTransport;
  onMessages: (messages: ChatMessage[]) => void;
  onState: (state: MonitorState) => void;
  onResolved?: (jevEnabled: boolean) => void;
  now?: () => number;
}) {
  let videoId: string | undefined;
  let chatId: string | undefined;
  let pageToken: string | undefined;
  const seen = createTransientMap<true>({ now });
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller = new AbortController();
  let generation = 0;
  let busy = false;
  let notBefore = 0;
  let credentialsAvailable = false;
  let awaitingTarget = false;
  let starting: boolean | undefined;
  let lastPollingInterval = DEFAULT_INTERVAL_MILLIS;

  function hold(error: ChatError) {
    if (error.code === 'aborted' && error.targetChanged === true) { awaitingTarget = true; return true; }
    const wait = error.retryAfterMillis ?? 0;
    if (error.code === 'rateLimited' && error.waitRequired === true && Number.isFinite(wait) && wait > 0) {
      notBefore = Math.max(notBefore, now() + wait); return true;
    }
    return false;
  }

  function schedule() {
    clearTimeout(timer);
    if (running && !busy && !awaitingTarget) timer = setTimeout(() => { void tick(); }, Math.min(2147483647, Math.max(0, notBefore - now())));
  }
  async function tick() {
    if (!running || !videoId || busy) return;
    if (now() < notBefore) { schedule(); return; }
    busy = true;
    const current = generation;
    const signal = controller.signal;
    notBefore = Math.max(notBefore, now() + lastPollingInterval);
    try {
      if (starting !== undefined && transport.startCollection) {
        const started = await transport.startCollection(videoId, starting, signal);
        if (!running || current !== generation || signal.aborted) return;
        if (!started.ok) {
          if (hold(started.error)) return;
          running = false; onState({ status: 'error', error: started.error }); return;
        }
        starting = undefined;
      }
      if (transport.readiness) {
        const readiness = await transport.readiness(signal);
        if (!running || current !== generation || signal.aborted) return;
        if (!readiness.ok) {
          if (hold(readiness.error)) return;
          running = false; onState({ status: 'error', error: readiness.error }); return;
        }
        if (readiness.value.waitMillis > 0) {
          notBefore = Math.max(notBefore, now() + readiness.value.waitMillis);
          return;
        }
      }
      const result = chatId ? await transport.listMessages(chatId, pageToken, signal)
        : await transport.resolveVideo(videoId, signal);
      // 停止後の遅延応答でも、サーバー指定の待機時間は短縮しない。
      if (result.ok && 'pollingIntervalMillis' in result.value) lastPollingInterval = Math.max(DEFAULT_INTERVAL_MILLIS, result.value.pollingIntervalMillis);
      const wait = !result.ok ? result.error.retryAfterMillis ?? 0 : 0;
      notBefore = Math.max(notBefore, now() + Math.max(lastPollingInterval, wait));
      if (!running || current !== generation || signal.aborted) return;
      if (!result.ok) {
        if (hold(result.error)) return;
        running = false;
        onState({ status: result.error.code === 'ended' ? 'ended' : 'error', error: failure(result.error.code, result.error.retryAfterMillis).error });
        return;
      }
      if ('liveChatId' in result.value) {
        chatId = result.value.liveChatId;
        onResolved(result.value.jevEnabled === true);
      } else {
        pageToken = result.value.nextPageToken;
        let overflow = false;
        const messages = result.value.messages.filter(message => {
          if (seen.has(message.id)) return false;
          if (!seen.set(message.id, true)) { overflow = true; return false; }
          return true;
        });
        if (messages.length) onMessages(messages);
        if (overflow && running && current === generation) {
          running = false;
          onState({ status: 'error', error: { code: 'unavailable', message: 'コメントが多く、取得を停止しました。未処理のコメントは未判定です。60秒後に「取得を開始」を押してください。' } });
        }
        if (result.value.ended && running && current === generation) {
          running = false;
          onState({ status: 'ended' });
        }
      }
    } catch {
      if (running && current === generation) {
        running = false;
        onState({ status: 'error', error: failure('network').error });
      }
    } finally {
      busy = false;
      schedule();
    }
  }
  function stop() {
    running = false;
    awaitingTarget = false;
    starting = undefined;
    generation++;
    controller.abort();
    clearTimeout(timer);
    onState({ status: 'stopped' });
  }
  return {
    isRunning: () => running,
    followVideo(id: string | undefined) {
      const resume = running;
      this.setVideo(id);
      if (resume) this.start(false);
    },
    setVideo(id: string | undefined) {
      if (id === videoId) return;
      stop();
      videoId = id;
      chatId = undefined;
      pageToken = undefined;
      seen.clear();
    },
    credentialsChanged(available: boolean) {
      stop();
      credentialsAvailable = available;
      chatId = undefined;
      pageToken = undefined;
    },
    start(explicit = true) {
      if (running || !credentialsAvailable || !videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;
      controller = new AbortController();
      starting = explicit;
      running = true;
      onState({ status: 'running' });
      schedule();
    },
    stop,
  };
}
