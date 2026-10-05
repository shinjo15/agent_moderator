import { failure, type ChatError, type ChatMessage, type ChatPage, type Result } from './contracts';

// キーはtrusted backgroundだけが扱う。monitorページには取得結果だけが渡る。
export type ChatTransport = {
  resolveVideo(videoId: string, signal: AbortSignal): Promise<Result<{ liveChatId: string }>>;
  listMessages(liveChatId: string, pageToken: string | undefined, signal: AbortSignal): Promise<Result<ChatPage>>;
};
export type MonitorState = { status: 'stopped' | 'running' | 'error' | 'ended'; error?: ChatError };
export const DEFAULT_INTERVAL_MILLIS = 5000;

export function createChatMonitor({ transport, onMessages, onState, now = () => performance.now() }: {
  transport: ChatTransport;
  onMessages: (messages: ChatMessage[]) => void;
  onState: (state: MonitorState) => void;
  now?: () => number;
}) {
  let videoId: string | undefined;
  let chatId: string | undefined;
  let pageToken: string | undefined;
  const seen = new Set<string>();
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller = new AbortController();
  let generation = 0;
  let busy = false;
  let notBefore = 0;
  let credentialsAvailable = false;
  let lastPollingInterval = DEFAULT_INTERVAL_MILLIS;

  function schedule() {
    clearTimeout(timer);
    if (running && !busy) timer = setTimeout(() => { void tick(); }, Math.min(2147483647, Math.max(0, notBefore - now())));
  }
  async function tick() {
    if (!running || !videoId || busy) return;
    if (now() < notBefore) { schedule(); return; }
    busy = true;
    const current = generation;
    const signal = controller.signal;
    notBefore = Math.max(notBefore, now() + lastPollingInterval);
    try {
      const result = chatId ? await transport.listMessages(chatId, pageToken, signal)
        : await transport.resolveVideo(videoId, signal);
      // 停止後の遅延応答でも、サーバー指定の待機時間は短縮しない。
      if (result.ok && 'pollingIntervalMillis' in result.value) lastPollingInterval = Math.max(DEFAULT_INTERVAL_MILLIS, result.value.pollingIntervalMillis);
      const wait = !result.ok ? result.error.retryAfterMillis ?? 0 : 0;
      notBefore = Math.max(notBefore, now() + Math.max(lastPollingInterval, wait));
      if (!running || current !== generation || signal.aborted) return;
      if (!result.ok) {
        running = false;
        onState({ status: result.error.code === 'ended' ? 'ended' : 'error', error: failure(result.error.code, result.error.retryAfterMillis).error });
        return;
      }
      if ('liveChatId' in result.value) {
        chatId = result.value.liveChatId;
      } else {
        pageToken = result.value.nextPageToken;
        const messages = result.value.messages.filter(message => {
          if (seen.has(message.id)) return false;
          seen.add(message.id);
          return true;
        });
        if (messages.length) onMessages(messages);
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
    generation++;
    controller.abort();
    clearTimeout(timer);
    onState({ status: 'stopped' });
  }
  return {
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
    start() {
      if (running || !credentialsAvailable || !videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return;
      controller = new AbortController();
      running = true;
      onState({ status: 'running' });
      schedule();
    },
    stop,
  };
}
