import type { MessageSender } from '../extension-runtime';
import { failure, type ChatPage, type Result, type YouTubeClient } from './contracts';
import { DEFAULT_INTERVAL_MILLIS } from './monitor';
import { videoIdFromUrl } from './video-id';

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

export function createYouTubeHandler({ session, tabs, runtime, client, initialize, readApiKey, now = Date.now }: {
  session: SessionStorage; tabs: ExtensionTabs;
  runtime: { id: string; getURL(path: string): string; sendMessage(message: unknown): Promise<unknown> };
  client: YouTubeClient; initialize: () => Promise<void>; readApiKey: () => Promise<string | undefined>; now?: () => number;
}) {
  let gate: Promise<void> | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let stateQueue: Promise<unknown> = Promise.resolve();
  let bindingGeneration = 0;
  let inflight: { requestId: string; controller: AbortController; binding: Binding } | undefined;
  let credentialGeneration = 0;
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
    if (changed(inflight?.binding)) inflight?.controller.abort();
    const generation = bindingGeneration;
    await ready();
    await stateExclusive(async () => {
      if (generation !== bindingGeneration) return;
      const selected = await binding();
      if (generation !== bindingGeneration || !changed(selected)) return;
      bindingGeneration++;
      inflight?.controller.abort();
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
        const previous = await binding();
        let monitorTabId: number | undefined;
        if (previous) {
          try { if ((await tabs.get(previous.monitorTabId)).url === runtime.getURL('monitor.html')) monitorTabId = previous.monitorTabId; } catch { /* Closed. */ }
        }
        // Write binding before navigating to the exact allowlisted page (no query/hash or keys).
        if (monitorTabId === undefined) monitorTabId = (await tabs.create({ url: 'about:blank' })).id;
        if (monitorTabId === undefined) return failure('network');
        await session.set({ [BINDING]: { monitorTabId, targetTabId: message.tabId, videoId: message.videoId } });
        bindingGeneration++;
        if (previous?.monitorTabId === monitorTabId) await notify({ type: 'youtube.targetChanged' });
        await tabs.update(monitorTabId, { url: runtime.getURL('monitor.html'), active: true });
        return { ok: true, value: { monitorTabId } };
      });
      const selectedGeneration = bindingGeneration;
      const selected = await binding();
      if (!selected || tabId(sender) !== selected.monitorTabId) return failure('forbidden');
      if (message.type === 'youtube.cancel') {
        if (!text(message.requestId)) return failure('invalidInput');
        cancelled.add(message.requestId);
        if (cancelled.size > 100) cancelled.delete(cancelled.values().next().value!);
        if (inflight?.requestId === message.requestId) inflight.controller.abort();
        return { ok: true, value: {} };
      }
      if (videoIdFromUrl((await tabs.get(selected.targetTabId)).url) !== selected.videoId) return failure('invalidInput');
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
