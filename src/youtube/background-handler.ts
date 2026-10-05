import type { MessageSender } from '../extension-runtime';
import { failure, type ChatPage, type Result, type YouTubeClient } from './contracts';
import { DEFAULT_INTERVAL_MILLIS } from './monitor';
import { videoIdFromUrl } from './video-id';
import type { createModeration } from '../jev/moderation';
import { validAuthor, type createHiddenAuthors } from '../hidden-authors/store';

export interface SessionStorage {
  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}
export interface ExtensionTabs {
  get(id: number): Promise<{ id?: number; url?: string }>;
  create(options: { url: string }): Promise<{ id?: number }>;
  update(id: number, options: { url?: string; active?: boolean }): Promise<unknown>;
}
type Binding = { monitorTabId: number; targetTabId: number; videoId: string; liveChatId?: string };
const BINDING = 'youtube.monitorBinding';
const COOLDOWN = 'youtube.cooldown';
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function tabId(sender: MessageSender): number | undefined {
  return object(sender.tab) && Number.isSafeInteger(sender.tab.id) ? sender.tab.id as number : undefined;
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 10000; }

export function createYouTubeHandler({ session, tabs, runtime, client, initialize, readApiKey, moderation, hiddenAuthors, now = Date.now }: {
  session: SessionStorage; tabs: ExtensionTabs;
  runtime: { id: string; getURL(path: string): string; sendMessage(message: unknown): Promise<unknown> };
  client: YouTubeClient; initialize: () => Promise<void>; readApiKey: () => Promise<string | undefined>; now?: () => number;
  moderation?: ReturnType<typeof createModeration>;
  hiddenAuthors?: ReturnType<typeof createHiddenAuthors>;
}) {
  let gate: Promise<void> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let stateQueue: Promise<unknown> = Promise.resolve();
  let bindingGeneration = 0;
  let inflight: { requestId: string; controller: AbortController; binding: Binding } | undefined;
  let credentialGeneration = 0;
  let activeBinding: { generation: number; binding: Binding } | undefined;
  let collectionGeneration = 0;
  const observations = new Map<string, { video: string; author: string; revision: number; generation: number }>();
  const cancelled = new Set<string>();
  const ready = () => gate ??= initialize().then(() => session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }));
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work, work);
    queue = result.catch(() => {});
    return result;
  };
  const stateExclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const result = stateQueue.then(work, work);
    stateQueue = result.catch(() => {});
    return result;
  };
  async function binding(): Promise<Binding | undefined> {
    const value = (await session.get([BINDING]))[BINDING];
    return object(value) && Number.isSafeInteger(value.monitorTabId) && Number.isSafeInteger(value.targetTabId)
      && text(value.videoId) ? value as Binding : undefined;
  }
  async function notify(message: unknown) { try { await runtime.sendMessage(message); } catch { /* No open monitor. */ } }
  async function credentialsChanged() {
    collectionGeneration++;
    moderation?.stopCollection();
    credentialGeneration++;
    inflight?.controller.abort();
    await ready();
    await notify({ type: 'youtube.credentialsChanged', available: Boolean(await readApiKey()) });
  }
  async function targetChanged(id: number, url?: string) {
    const changed = (selected: Binding | undefined) => selected !== undefined
      && (selected.monitorTabId === id || selected.targetTabId === id)
      && !(url !== undefined && ((selected.targetTabId === id && videoIdFromUrl(url) === selected.videoId)
        || (selected.monitorTabId === id && url === runtime.getURL('monitor.html'))));
    // Abort must not wait for session I/O, the state lock, or an API response.
    if (activeBinding?.generation === bindingGeneration && changed(activeBinding.binding)) { collectionGeneration++; moderation?.reset(); }
    if (changed(inflight?.binding)) inflight?.controller.abort();
    const generation = bindingGeneration;
    await ready();
    await stateExclusive(async () => {
      if (generation !== bindingGeneration) return;
      const selected = await binding();
      if (generation !== bindingGeneration || !changed(selected)) return;
      bindingGeneration++;
      inflight?.controller.abort();
      moderation?.reset(); activeBinding = undefined;
      await session.remove([BINDING]);
      await notify({ type: 'youtube.targetChanged' });
    });
  }
  async function handle(message: unknown, sender: MessageSender): Promise<unknown> {
    if (!object(message) || typeof message.type !== 'string' || sender.id !== runtime.id) return failure('forbidden');
    const popup = sender.url === runtime.getURL('popup.html');
    const monitor = sender.url === runtime.getURL('monitor.html');
    if (message.type === 'youtube.openMonitor' ? !popup : !monitor) return failure('forbidden');
    try {
      await ready();
      if (message.type === 'youtube.openMonitor') return await stateExclusive(async () => {
        if (!Number.isSafeInteger(message.tabId) || typeof message.videoId !== 'string'
          || videoIdFromUrl((await tabs.get(message.tabId as number)).url) !== message.videoId) return failure('invalidInput');
        inflight?.controller.abort();
        collectionGeneration++; observations.clear();
        const previous = await binding();
        moderation?.reset();
        let monitorTabId: number | undefined;
        if (previous) {
          try { if ((await tabs.get(previous.monitorTabId)).url === runtime.getURL('monitor.html')) monitorTabId = previous.monitorTabId; } catch { /* Closed. */ }
        }
        // Write binding before navigating to the exact allowlisted page (no query/hash or keys).
        if (monitorTabId === undefined) monitorTabId = (await tabs.create({ url: 'about:blank' })).id;
        if (monitorTabId === undefined) return failure('network');
        await session.set({ [BINDING]: { monitorTabId, targetTabId: message.tabId, videoId: message.videoId } });
        bindingGeneration++;
        moderation?.reset();
        if (previous?.monitorTabId === monitorTabId) await notify({ type: 'youtube.targetChanged' });
        activeBinding = { generation: bindingGeneration, binding: { monitorTabId, targetTabId: message.tabId as number, videoId: message.videoId } };
        await tabs.update(monitorTabId, { url: runtime.getURL('monitor.html'), active: true });
        return { ok: true, value: { monitorTabId } };
      });
      const selectedGeneration = bindingGeneration;
      const selectedCollection = collectionGeneration;
      const selected = await binding();
      if (!selected || tabId(sender) !== selected.monitorTabId) return failure('forbidden');
      if (selectedGeneration !== bindingGeneration) return failure('aborted');
      activeBinding = { generation: selectedGeneration, binding: selected };
      if (message.type === 'youtube.cancel') {
        if (!text(message.requestId)) return failure('invalidInput');
        cancelled.add(message.requestId);
        if (cancelled.size > 100) cancelled.delete(cancelled.values().next().value!);
        if (inflight?.requestId === message.requestId) inflight.controller.abort();
        return { ok: true, value: {} };
      }
      if (videoIdFromUrl((await tabs.get(selected.targetTabId)).url) !== selected.videoId) return failure('invalidInput');
      if (selectedGeneration !== bindingGeneration) return failure('aborted');
      if (message.type.startsWith('jev.')) {
        if (!moderation) return failure('forbidden');
        const count = Object.keys(message).length;
        if (message.type === 'jev.disable' && count === 1) { moderation.stop(); return { ok: true }; }
        if (message.type === 'jev.stopCollection' && count === 1) { collectionGeneration++; moderation.stopCollection(); return { ok: true }; }
        let result: unknown;
        const collection = collectionGeneration;
        if (message.type === 'jev.enable' && count === 1) result = await moderation.enable();
        else if (message.type === 'jev.evaluate' && count === 2 && text(message.id)) {
          const evaluated = await moderation.evaluate(message.id);
          result = evaluated;
          const observed = observations.get(message.id);
          if (hiddenAuthors && evaluated.ok && evaluated.value.malicious === true && observed && observed.video === selected.videoId
            && observed.author === evaluated.value.authorChannelId && observed.generation === collection) {
            await stateExclusive(async () => {
              if (selectedGeneration !== bindingGeneration || collection !== collectionGeneration
                || videoIdFromUrl((await tabs.get(selected.targetTabId)).url) !== selected.videoId) return;
              await hiddenAuthors.add(observed.video, observed.author, observed.revision,
                () => selectedGeneration === bindingGeneration && collection === collectionGeneration);
            });
          }
        }
        else return failure('invalidInput');
        if (selectedGeneration !== bindingGeneration) return failure('aborted');
        return result;
      }
      if (message.type === 'youtube.status') return { ok: true, value: {
        videoId: selected.videoId, targetTabId: selected.targetTabId, credentialsAvailable: Boolean(await readApiKey()),
      } };
      if (!text(message.requestId) || !/^[A-Za-z0-9_-]{1,100}$/.test(message.requestId)) return failure('invalidInput');
      if (message.type === 'youtube.resolve') {
        if (message.videoId !== selected.videoId) return failure('invalidInput');
      } else if (message.type === 'youtube.list') {
        if (!text(message.liveChatId) || message.liveChatId !== selected.liveChatId
          || (message.pageToken !== undefined && !text(message.pageToken))) return failure('invalidInput');
      } else return failure('forbidden');
      return await exclusive(async () => {
        if (cancelled.has(message.requestId as string)) { cancelled.delete(message.requestId as string); return failure('aborted'); }
        const current = await binding();
        if (selectedGeneration !== bindingGeneration || !current || current.monitorTabId !== selected.monitorTabId || current.videoId !== selected.videoId
          || videoIdFromUrl((await tabs.get(current.targetTabId)).url) !== current.videoId) return failure('invalidInput');
        const generation = credentialGeneration;
        const key = await readApiKey();
        if (!key) return failure('auth');
        const stored = (await session.get([COOLDOWN]))[COOLDOWN];
        const interval = object(stored) && typeof stored.interval === 'number' && Number.isSafeInteger(stored.interval)
          ? Math.max(DEFAULT_INTERVAL_MILLIS, stored.interval) : DEFAULT_INTERVAL_MILLIS;
        const notBefore = object(stored) && typeof stored.notBefore === 'number' && Number.isFinite(stored.notBefore) ? stored.notBefore : 0;
        if (now() < notBefore) return failure('rateLimited', notBefore - now());
        // Crash/worker shutdown retains a conservative lease, not just the ordinary interval.
        await session.set({ [COOLDOWN]: { interval, notBefore: now() + Math.max(interval, 25000) } });
        const controller = new AbortController();
        inflight = { requestId: message.requestId as string, controller, binding: current };
        if (cancelled.has(inflight.requestId) || generation !== credentialGeneration || selectedGeneration !== bindingGeneration) controller.abort();
        try {
          const result: Result<{ liveChatId: string } | ChatPage> = message.type === 'youtube.resolve'
            ? await client.resolveVideo(current.videoId, key, controller.signal)
            : await client.listMessages(current.liveChatId!, message.pageToken as string | undefined, key, controller.signal);
          const nextInterval = result.ok && 'pollingIntervalMillis' in result.value ? Math.max(DEFAULT_INTERVAL_MILLIS, result.value.pollingIntervalMillis) : interval;
          const wait = !result.ok ? result.error.retryAfterMillis ?? 0 : 0;
          await session.set({ [COOLDOWN]: { interval: nextInterval, notBefore: now() + Math.max(nextInterval, wait) } });
          if (controller.signal.aborted || generation !== credentialGeneration || key !== await readApiKey()) return failure('aborted');
          return await stateExclusive(async () => {
            const latest = await binding();
            if (controller.signal.aborted || selectedGeneration !== bindingGeneration || !latest
              || latest.monitorTabId !== current.monitorTabId || latest.targetTabId !== current.targetTabId
              || latest.videoId !== current.videoId) return failure('aborted');
            if (result.ok && 'liveChatId' in result.value) await session.set({ [BINDING]: { ...latest, liveChatId: result.value.liveChatId } });
            if (controller.signal.aborted || selectedGeneration !== bindingGeneration || generation !== credentialGeneration) return failure('aborted');
            if (result.ok && 'messages' in result.value) {
              const collection = selectedCollection;
              if (collection !== collectionGeneration) return failure('aborted');
              if (hiddenAuthors) for (const post of result.value.messages) {
                if (validAuthor(post.authorChannelId) && !observations.has(post.id)) observations.set(post.id, {
                  video: current.videoId, author: post.authorChannelId, revision: await hiddenAuthors.revision(current.videoId, post.authorChannelId), generation: collection,
                });
              }
              if (controller.signal.aborted || selectedGeneration !== bindingGeneration || generation !== credentialGeneration || collection !== collectionGeneration) return failure('aborted');
              const bursts = moderation?.observe(result.value.messages) ?? [];
              if (hiddenAuthors) for (const post of bursts) {
                const observed = observations.get(post.id);
                if (observed) await hiddenAuthors.add(observed.video, observed.author, observed.revision,
                  () => !controller.signal.aborted && selectedGeneration === bindingGeneration && collection === collectionGeneration);
              }
            }
            return result;
          });
        } finally {
          cancelled.delete(message.requestId as string);
          inflight = undefined;
        }
      });
    } catch { return failure('network'); }
  }
  return { handle, credentialsChanged, targetChanged };
}
