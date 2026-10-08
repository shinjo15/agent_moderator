import type { MessageSender } from '../extension-runtime';
import { videoIdFromUrl } from '../youtube/video-id';
import { validAuthor, validVideo, type createHiddenAuthors } from './store';
export function chatVideo(url: string | undefined, referrer = ''): string | undefined {
  try {
    const parsed = new URL(url ?? '');
    if (parsed.origin !== 'https://www.youtube.com' || parsed.pathname !== '/live_chat') return;
    const direct = parsed.searchParams.get('v');
    if (validVideo(direct)) return direct;
    if (parsed.searchParams.has('v')) return;
    return videoIdFromUrl(referrer);
  } catch { return; }
}
export function createHiddenAuthorHandler({ store, tabs, session, runtime, clearAll }: {
  clearAll?(): Promise<void>;
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
    const admitted = store.isCurrent(epoch);
    if (m.type === 'hidden.clearAll') {
      if (sender.url !== runtime.getURL('options.html') || Object.keys(m).length !== 1 || !clearAll) return denied;
      try { await clearAll(); return { ok: true }; } catch { return denied; }
    }
    const tab = sender.tab as { id?: number } | undefined;
    if (!Number.isSafeInteger(tab?.id) || !validVideo(m.videoId)) return denied;
    try {
      if (sender.url === runtime.getURL('monitor.html')) {
        const binding = (await session.get(['youtube.monitorBinding']))['youtube.monitorBinding'] as { monitorTabId?: number; videoId?: string; targetTabId: number } | undefined;
        if (!binding || binding.monitorTabId !== tab!.id || binding.videoId !== m.videoId
          || videoIdFromUrl((await tabs.get(binding.targetTabId)).url) !== m.videoId) return denied;
        if (!admitted || !store.isCurrent(epoch)) return denied;
        if (m.type === 'hidden.remove' && Object.keys(m).length === 3 && validAuthor(m.authorChannelId)) await store.remove(m.videoId, m.authorChannelId, true);
        else if (m.type !== 'hidden.list' || Object.keys(m).length !== 2) return denied;
        const authors = await store.listAuthors(m.videoId);
        return { ok: true, videoId: m.videoId, ids: authors.map(author => author.authorChannelId), authors };
      } else {
        if (m.type !== 'hidden.list' || Object.keys(m).length !== 3 || typeof m.referrer !== 'string'
          || chatVideo(sender.url, m.referrer) !== m.videoId) return denied;
        const current = (await tabs.get(tab!.id!)).url;
        if ((videoIdFromUrl(current) ?? chatVideo(current)) !== m.videoId) return denied;
      }
      return { ok: true, videoId: m.videoId, ids: await store.list(m.videoId) };
    } catch { return denied; }
  }
  return { handle };
}
