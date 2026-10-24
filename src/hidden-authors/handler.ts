import type { MessageSender } from '../extension-runtime';
import { videoIdFromUrl } from '../youtube/video-id';
import { validAuthor, validVideo, type createHiddenAuthors } from './store';

export function createHiddenAuthorHandler({ store, tabs, session, runtime, clearAll, currentTargetEpoch = () => 0 }: {
  clearAll?(): Promise<void>;
  currentTargetEpoch?(): number | undefined;
  store: ReturnType<typeof createHiddenAuthors>;
  tabs: { get(id: number): Promise<{ url?: string }> };
  session: { get(keys: string[]): Promise<Record<string, unknown>> };
  runtime: { id: string; getURL(path: string): string };
}) {
  async function handle(message: unknown, sender: MessageSender): Promise<unknown> {
    const denied = { ok: false };
    if (typeof message !== 'object' || message === null || Array.isArray(message) || sender.id !== runtime.id) return denied;
    const m = message as Record<string, unknown>;
    const epoch = store.epoch();
    const targetEpoch = currentTargetEpoch();
    const currentScope = () => targetEpoch !== undefined && store.isCurrent(epoch) && currentTargetEpoch() === targetEpoch;
    const admitted = store.isCurrent(epoch);
    if (m.type === 'hidden.clearAll') {
      if (sender.url !== runtime.getURL('options.html') || Object.keys(m).length !== 1 || !clearAll) return denied;
      try { await clearAll(); return { ok: true }; } catch { return denied; }
    }
    const tab = sender.tab as { id?: number } | undefined;
    if (!Number.isSafeInteger(tab?.id) || !validVideo(m.videoId)) return denied;
    try {
      if (sender.url === runtime.getURL('monitor.html')) {
        const binding = (await session.get(['youtube.monitorBinding']))['youtube.monitorBinding'] as { monitorTabId?: number; videoId?: string; targetTabId: number; revision?: string; broadcasterChannelId?: string; liveChatId?: string } | undefined;
        if (!binding || binding.monitorTabId !== tab!.id || binding.videoId !== m.videoId
          || videoIdFromUrl((await tabs.get(binding.targetTabId)).url) !== m.videoId) return denied;
        if (!admitted || !currentScope()) return denied;
        if (m.type === 'hidden.remove' ? Object.keys(m).length !== 3 || !validAuthor(m.authorChannelId)
          : m.type !== 'hidden.list' || Object.keys(m).length !== 2) return denied;
        if (!validAuthor(binding.broadcasterChannelId)) return { ok: false, code: 'scopeUnresolved' };
        const current = async () => {
          const latest = (await session.get(['youtube.monitorBinding']))['youtube.monitorBinding'] as typeof binding;
          return latest?.monitorTabId === binding.monitorTabId && latest.targetTabId === binding.targetTabId && latest.videoId === binding.videoId
            && latest.revision === binding.revision
            && latest.broadcasterChannelId === binding.broadcasterChannelId && latest.liveChatId === binding.liveChatId
            && videoIdFromUrl((await tabs.get(binding.targetTabId)).url) === m.videoId && currentScope();
        };
        if (m.type === 'hidden.remove') await store.remove(binding.broadcasterChannelId, m.authorChannelId as string, true, current);
        const authors = await store.listAuthors(binding.broadcasterChannelId);
        if (!await current()) return denied;
        return { ok: true, videoId: m.videoId, ids: authors.map(author => author.authorChannelId), authors };
      }
      return denied;
    } catch { return denied; }
  }
  return { handle };
}
