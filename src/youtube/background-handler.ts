import type { MessageSender } from '../extension-runtime';
import { failure, validDisplayName, type ChatPage, type ResolvedVideo, type Result, type YouTubeClient } from './contracts';
import { DEFAULT_INTERVAL_MILLIS } from './monitor';
import { videoIdFromUrl } from './video-id';
import type { createModeration } from '../jev/moderation';
import { validAuthor, validVideo, type createHiddenAuthors } from '../hidden-authors/store';
import { createBoundedQueue, createTransientMap } from '../retention';

export interface SessionStorage {
  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}
export interface ExtensionTabs {
  get(id: number): Promise<{ id?: number; url?: string; windowId?: number }>;
  create(options: { url: string }): Promise<{ id?: number }>;
  update(id: number, options: { url?: string; active?: boolean }): Promise<unknown>;
}
export interface ExtensionWindows {
  create(options: { url: string; type: 'normal'; width: number; height: number }): Promise<{ id?: number; tabs?: { id?: number }[] }>;
  get(id: number): Promise<{ type?: string }>;
  update(id: number, options: { focused: boolean }): Promise<unknown>;
}
type Binding = { monitorTabId: number; targetTabId: number; videoId: string; revision?: string; liveChatId?: string; broadcasterChannelId?: string };
const BINDING = 'youtube.monitorBinding';
const COOLDOWN = 'youtube.cooldown';
const PAUSED = 'hidden.collectionPaused';
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function tabId(sender: MessageSender): number | undefined {
  return object(sender.tab) && Number.isSafeInteger(sender.tab.id) ? sender.tab.id as number : undefined;
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 10000; }

export function createYouTubeHandler({ session, tabs, windows, runtime, client, initialize, readApiKey, moderation, hiddenAuthors, readConfirmation = async () => false, now = Date.now }: {
  session: SessionStorage; tabs: ExtensionTabs; windows: ExtensionWindows;
  runtime: { id: string; getURL(path: string): string; sendMessage(message: unknown): Promise<unknown> };
  client: YouTubeClient; initialize: () => Promise<void>; readApiKey: () => Promise<string | undefined>; now?: () => number;
  moderation?: ReturnType<typeof createModeration>;
  hiddenAuthors?: ReturnType<typeof createHiddenAuthors>;
  readConfirmation?: () => Promise<boolean>;
}) {
  let gate: Promise<void> | undefined;
  const exclusive = createBoundedQueue({ now });
  const stateExclusive = createBoundedQueue({ now });
  let bindingGeneration = 0;
  let inflight: { requestId: string; controller: AbortController; binding: Binding } | undefined;
  let credentialGeneration = 0;
  let activeBinding: { generation: number; binding: Binding } | undefined;
  let collectionGeneration = 0;
  let deletionEpoch = 0;
  let deleting = false;
  let collectionPaused = false;
  let resumeJev = false;
  function stopJev() { resumeJev = false; moderation?.stop(); }
  const navigations = createTransientMap<number>({ now });
  let navigationSequence = 0;
  let targetEpoch = 0;
  let changingTarget = false;
  const targetPending = () => ({ ok: false as const, error: { ...failure('aborted').error, targetChanged: true as const } });
  type Observation = { video: string; channel: string; author: string; revision: number; generation: number; displayName?: string; nameSequence: number };
  const observations = createTransientMap<Observation>({ now });
  let nameSequence = 0;
  function latestDisplayName(observed: Observation) {
    // Reuse the bounded, expiring observations; no additional author history/archive.
    let latest = observed;
    for (const value of observations.values()) {
      if (value.video === observed.video && value.author === observed.author && value.revision === observed.revision
        && value.generation === observed.generation && value.nameSequence > latest.nameSequence
        && validDisplayName(value.displayName)) latest = value;
    }
    return latest.displayName;
  }
  const cancelled = new Set<string>();
  const ready = () => gate ??= initialize().then(async () => {
    await session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    if ((await session.get([PAUSED]))[PAUSED] === true) collectionPaused = true;
  });
  async function binding(): Promise<Binding | undefined> {
    const value = (await session.get([BINDING]))[BINDING];
    return object(value) && Number.isSafeInteger(value.monitorTabId) && Number.isSafeInteger(value.targetTabId)
      && validVideo(value.videoId) ? value as Binding : undefined;
  }
  async function notify(message: unknown) { try { await runtime.sendMessage(message); } catch { /* No open monitor. */ } }
  async function clearHiddenData() {
    if (deleting || !hiddenAuthors) throw new Error('Deletion unavailable');
    // Invalidate synchronously, before any storage/queue/notification await.
    deleting = true; deletionEpoch++; collectionGeneration++; collectionPaused = true; resumeJev = false;
    inflight?.controller.abort(); observations.clear(); moderation?.reset();
    void notify({ type: 'hidden.clearing' });
    try {
      await ready();
      // Worker recreation must not let an old polling loop resume collection.
      await stateExclusive(async () => {
        observations.clear();
        await session.set({ [PAUSED]: true });
        if ((await session.get([PAUSED]))[PAUSED] !== true) throw new Error('Collection stop not verified');
        await hiddenAuthors.clearAll();
      });
    } finally {
      deleting = false;
      await notify({ type: 'hidden.refresh' });
    }
  }
  async function credentialsChanged() {
    resumeJev = false; collectionPaused = true;
    collectionGeneration++;
    moderation?.stopCollection();
    credentialGeneration++;
    inflight?.controller.abort();
    await ready();
    await stateExclusive(() => session.set({ [PAUSED]: true }));
    await notify({ type: 'youtube.credentialsChanged', available: Boolean(await readApiKey()) });
  }
  async function confirmationChanged() {
    resumeJev = false; collectionPaused = true;
    collectionGeneration++;
    moderation?.stopCollection();
    inflight?.controller.abort();
    await stateExclusive(() => session.set({ [PAUSED]: true }));
    return notify({ type: 'confirmation.changed' });
  }
  async function targetChanged(id: number, url?: string) {
    const changed = (selected: Binding | undefined) => selected !== undefined
      && (selected.monitorTabId === id || selected.targetTabId === id)
      && !(url !== undefined && ((selected.targetTabId === id && videoIdFromUrl(url) === selected.videoId && !changingTarget)
        || (selected.monitorTabId === id && url === runtime.getURL('monitor.html'))));
    function invalidate() {
      changingTarget = true; targetEpoch++; collectionGeneration++;
      resumeJev = resumeJev || moderation?.isEnabled() === true;
      observations.clear(); moderation?.reset(); inflight?.controller.abort();
    }
    // Abort and revoke hidden-operation admission before any storage/queue await.
    const invalidated = (activeBinding?.generation === bindingGeneration && changed(activeBinding.binding)) || changed(inflight?.binding);
    if (invalidated) invalidate();
    const navigation = ++navigationSequence;
    navigations.set(String(id), navigation);
    const generation = bindingGeneration;
    await ready();
    await stateExclusive(async () => {
      const selected = await binding();
      if (generation !== bindingGeneration || navigations.get(String(id)) !== navigation || !changed(selected)) return;
      if (!invalidated) invalidate();
      // The event URL is only a hint. Read the bound tab, never the active tab.
      let video: string | undefined;
      if (selected!.targetTabId === id && url !== undefined) {
        try { video = videoIdFromUrl((await tabs.get(id)).url); } catch { /* Closed or inaccessible. */ }
      }
      if (navigations.get(String(id)) !== navigation) return;
      bindingGeneration++;
      activeBinding = undefined;
      if (video) {
        let savedChannel: string | undefined;
        try { savedChannel = await hiddenAuthors?.channelForVideo(video); } catch { /* Keep the scope unresolved. */ }
        if (navigations.get(String(id)) !== navigation) return;
        const next: Binding = { monitorTabId: selected!.monitorTabId, targetTabId: id, videoId: video, revision: crypto.randomUUID(),
          ...(savedChannel === undefined ? {} : { broadcasterChannelId: savedChannel }) };
        await session.set({ [BINDING]: next });
        if (navigations.get(String(id)) !== navigation) return;
        activeBinding = { generation: bindingGeneration, binding: next };
      } else {
        resumeJev = false;
        collectionPaused = true;
        await session.set({ [PAUSED]: true });
        await session.remove([BINDING]);
      }
      changingTarget = false;
      await notify({ type: 'youtube.targetChanged' });
    });
  }
  async function targetUpdated(id: number) {
    // Cross-origin navigation may hide changeInfo.url after activeTab is revoked.
    await ready();
    if ((await binding())?.targetTabId !== id) return;
    let url = '';
    try { url = (await tabs.get(id)).url ?? ''; } catch { /* Treat as unavailable. */ }
    await targetChanged(id, url);
  }
  async function handle(message: unknown, sender: MessageSender): Promise<unknown> {
    if (!object(message) || typeof message.type !== 'string' || sender.id !== runtime.id) return failure('forbidden');
    const popup = sender.url === runtime.getURL('popup.html');
    const monitor = sender.url === runtime.getURL('monitor.html');
    if (message.type === 'youtube.openMonitor' ? !popup : !monitor) return failure('forbidden');
    const requestEpoch = deletionEpoch;
    const admitted = !deleting;
    const currentEpoch = () => admitted && requestEpoch === deletionEpoch && !deleting;
    // Admission epoch must precede every await, including worker initialization.
    const selectedCollection = collectionGeneration;
    const collects = message.type === 'youtube.start' || message.type === 'youtube.resolve' || message.type === 'youtube.list'
      || message.type === 'jev.enable' || message.type === 'jev.evaluate';
    const staleCollection = () => collects && (selectedCollection !== collectionGeneration
      || (collectionPaused && (message.type === 'youtube.resolve' || message.type === 'youtube.list')));
    try {
      await ready();
      if (!currentEpoch() || staleCollection()) return failure('aborted');
      if (message.type === 'youtube.openMonitor') return await stateExclusive(async () => {
        if (!currentEpoch()) return failure('aborted');
        if (!Number.isSafeInteger(message.tabId) || typeof message.videoId !== 'string') return failure('invalidInput');
        const target = await tabs.get(message.tabId as number);
        if (videoIdFromUrl(target.url) !== message.videoId) return failure('invalidInput');
        if (target.windowId === undefined || !Number.isSafeInteger(target.windowId) || target.windowId < 0) return failure('network');
        if (!currentEpoch()) return failure('aborted');
        inflight?.controller.abort();
        collectionGeneration++; observations.clear();
        const previous = await binding();
        if (!currentEpoch()) return failure('aborted');
        resumeJev = false; moderation?.reset();
        let monitorTabId: number | undefined;
        let reuseWindowId: number | undefined;
        if (previous) {
          try {
            const viewer = await tabs.get(previous.monitorTabId);
            if (viewer.url === runtime.getURL('monitor.html') && viewer.windowId !== undefined
              && Number.isSafeInteger(viewer.windowId) && viewer.windowId >= 0 && viewer.windowId !== target.windowId
              && (await windows.get(viewer.windowId)).type === 'normal') {
              monitorTabId = previous.monitorTabId; reuseWindowId = viewer.windowId;
            }
          } catch { /* Closed or unavailable. */ }
        }
        // Write binding before navigating to the exact allowlisted page (no query/hash or keys).
        if (monitorTabId === undefined) {
          const created = await windows.create({ url: 'about:blank', type: 'normal', width: 480, height: 800 });
          if (created.id === undefined || !Number.isSafeInteger(created.id) || created.id < 0 || created.id === target.windowId) return failure('network');
          monitorTabId = created.tabs?.[0]?.id;
        }
        if (monitorTabId === undefined || !Number.isSafeInteger(monitorTabId) || monitorTabId < 0) return failure('network');
        const savedChannel = await hiddenAuthors?.channelForVideo(message.videoId);
        if (!currentEpoch()) return failure('aborted');
        const nextBinding = { monitorTabId, targetTabId: message.tabId as number, videoId: message.videoId,
          ...(savedChannel === undefined ? {} : { broadcasterChannelId: savedChannel }) };
        await session.set({ [BINDING]: nextBinding });
        bindingGeneration++;
        changingTarget = false;
        moderation?.reset();
        if (previous?.monitorTabId === monitorTabId) await notify({ type: 'youtube.targetChanged' });
        activeBinding = { generation: bindingGeneration, binding: nextBinding };
        await tabs.update(monitorTabId, { url: runtime.getURL('monitor.html'), active: true });
        if (reuseWindowId !== undefined) await windows.update(reuseWindowId, { focused: true });
        return { ok: true, value: { monitorTabId } };
      });
      let selectedGeneration = bindingGeneration;
      const selected = await binding();
      if (!currentEpoch()) return failure('aborted');
      if (!selected || tabId(sender) !== selected.monitorTabId) return failure('forbidden');
      // Stop is authorized by the bound monitor, not by a navigating parent's URL.
      if (message.type === 'jev.disable' && Object.keys(message).length === 1) { stopJev(); return { ok: true }; }
      if (message.type === 'jev.stopCollection' && Object.keys(message).length === 1) {
        collectionGeneration++; collectionPaused = true; resumeJev = false;
        inflight?.controller.abort(); observations.clear(); moderation?.stopCollection();
        await stateExclusive(() => session.set({ [PAUSED]: true }));
        return { ok: true };
      }
      if (changingTarget && (collects || message.type === 'youtube.status')) return targetPending();
      if (selectedGeneration !== bindingGeneration || staleCollection()) return failure('aborted');
      activeBinding = { generation: selectedGeneration, binding: selected };
      if (message.type === 'youtube.cancel') {
        if (!text(message.requestId)) return failure('invalidInput');
        cancelled.add(message.requestId);
        if (cancelled.size > 100) cancelled.delete(cancelled.values().next().value!);
        if (inflight?.requestId === message.requestId) inflight.controller.abort();
        return { ok: true, value: {} };
      }
      const targetUrl = (await tabs.get(selected.targetTabId)).url;
      if (changingTarget) return targetPending();
      if (!currentEpoch() || selectedGeneration !== bindingGeneration || staleCollection()) return failure('aborted');
      if (videoIdFromUrl(targetUrl) !== selected.videoId) return failure('invalidInput');
      if (message.type === 'youtube.start') {
        if (typeof message.explicit !== 'boolean' || message.videoId !== selected.videoId
          || Object.keys(message).some(key => !['type', 'explicit', 'videoId', 'requestId'].includes(key))) return failure('invalidInput');
        return await stateExclusive(async () => {
          if (!currentEpoch() || staleCollection() || selectedGeneration !== bindingGeneration || (!message.explicit && collectionPaused)) return failure('aborted');
          if (!message.explicit) return { ok: true };
          collectionPaused = false;
          await session.set({ [PAUSED]: false });
          if (!currentEpoch() || staleCollection() || selectedGeneration !== bindingGeneration) {
            collectionPaused = true; await session.set({ [PAUSED]: true }); return failure('aborted');
          }
          return { ok: true };
        });
      }
      if (message.type.startsWith('jev.')) {
        if (!moderation) return failure('forbidden');
        const count = Object.keys(message).length;
        let result: unknown;
        const collection = selectedCollection;
        if (message.type === 'jev.enable' && count === 1) result = await moderation.enable();
        else if (message.type === 'jev.evaluate' && count === 2 && text(message.id)) {
          const observed = observations.get(message.id);
          const target = moderation.target(message.id);
          const evaluated = await moderation.evaluate(message.id);
          result = evaluated;
          if (hiddenAuthors && target && moderation.target(message.id) === target && evaluated.ok && evaluated.value.malicious === true && observed && observed.video === selected.videoId
            && observations.get(message.id) === observed && observed.author === evaluated.value.authorChannelId && observed.generation === collection) {
            await stateExclusive(async () => {
              if (!await readConfirmation()) return;
              if (!currentEpoch() || selectedGeneration !== bindingGeneration || collection !== collectionGeneration
                || videoIdFromUrl((await tabs.get(selected.targetTabId)).url) !== selected.videoId) return;
              await hiddenAuthors.add(observed.channel, observed.author, observed.revision,
                () => currentEpoch() && selectedGeneration === bindingGeneration && collection === collectionGeneration && observations.get(message.id as string) === observed
                  && moderation.target(message.id as string) === target,
                latestDisplayName(observed), { text: target.text, videoId: observed.video });
            });
          }
        }
        else return failure('invalidInput');
        if (!currentEpoch() || selectedGeneration !== bindingGeneration || staleCollection()) return failure('aborted');
        return result;
      }
      if (message.type === 'youtube.status') {
        const cooldown = (await session.get([COOLDOWN]))[COOLDOWN];
        const waitMillis = object(cooldown) && typeof cooldown.notBefore === 'number' && Number.isFinite(cooldown.notBefore)
          ? Math.max(0, cooldown.notBefore - now()) : 0;
        return { ok: true, value: {
        videoId: selected.videoId, targetTabId: selected.targetTabId, credentialsAvailable: Boolean(await readApiKey()),
        waitMillis, paused: collectionPaused, revision: selected.revision,
      } };
      }
      if (!text(message.requestId) || !/^[A-Za-z0-9_-]{1,100}$/.test(message.requestId)) return failure('invalidInput');
      if (message.type === 'youtube.resolve') {
        if (message.videoId !== selected.videoId) return failure('invalidInput');
      } else if (message.type === 'youtube.list') {
        if (collectionPaused) return failure('aborted');
        if (!validAuthor(selected.broadcasterChannelId) || !text(message.liveChatId) || message.liveChatId !== selected.liveChatId
          || (message.pageToken !== undefined && !text(message.pageToken))) return failure('invalidInput');
      } else return failure('forbidden');
      return await exclusive(async () => {
        if (!currentEpoch() || staleCollection()) return failure('aborted');
        if (cancelled.has(message.requestId as string)) { cancelled.delete(message.requestId as string); return failure('aborted'); }
        const current = await binding();
        if (selectedGeneration !== bindingGeneration || !current || current.monitorTabId !== selected.monitorTabId || current.videoId !== selected.videoId) return failure('aborted');
        const currentUrl = (await tabs.get(current.targetTabId)).url;
        if (changingTarget) return targetPending();
        if (!currentEpoch() || selectedGeneration !== bindingGeneration || staleCollection()) return failure('aborted');
        if (videoIdFromUrl(currentUrl) !== current.videoId) return failure('invalidInput');
        if (message.type === 'youtube.resolve') {
          const invalidated = await stateExclusive(async () => {
            if (!currentEpoch() || staleCollection() || selectedGeneration !== bindingGeneration) return false;
            selectedGeneration = ++bindingGeneration;
            observations.clear();
            const unresolved = { monitorTabId: current.monitorTabId, targetTabId: current.targetTabId, videoId: current.videoId, revision: current.revision };
            activeBinding = { generation: selectedGeneration, binding: unresolved };
            await session.set({ [BINDING]: unresolved });
            await hiddenAuthors?.forgetVideo(current.videoId, () => currentEpoch() && selectedGeneration === bindingGeneration && !staleCollection());
            await notify({ type: 'hidden.scopeChanged' });
            return true;
          });
          if (!invalidated || !currentEpoch() || staleCollection() || selectedGeneration !== bindingGeneration) return failure('aborted');
        } else if (!validAuthor(current.broadcasterChannelId) || current.liveChatId !== message.liveChatId) return failure('invalidInput');
        const generation = credentialGeneration;
        const confirmed = await readConfirmation();
        if (!currentEpoch() || staleCollection()) return failure('aborted');
        if (!confirmed) { moderation?.stopCollection(); return failure('confirmationRequired'); }
        const key = await readApiKey();
        if (!currentEpoch() || staleCollection()) return failure('aborted');
        if (!key) return failure('auth');
        const stored = (await session.get([COOLDOWN]))[COOLDOWN];
        if (!currentEpoch()) return failure('aborted');
        const interval = object(stored) && typeof stored.interval === 'number' && Number.isSafeInteger(stored.interval)
          ? Math.max(DEFAULT_INTERVAL_MILLIS, stored.interval) : DEFAULT_INTERVAL_MILLIS;
        const notBefore = object(stored) && typeof stored.notBefore === 'number' && Number.isFinite(stored.notBefore) ? stored.notBefore : 0;
        if (now() < notBefore) return { ok: false, error: { ...failure('rateLimited', notBefore - now()).error, waitRequired: true } };
        // Crash/worker shutdown retains a conservative lease, not just the ordinary interval.
        await session.set({ [COOLDOWN]: { interval, notBefore: now() + Math.max(interval, 25000) } });
        if (!currentEpoch()) return failure('aborted');
        const sendConfirmed = await readConfirmation();
        if (!currentEpoch() || staleCollection()) return failure('aborted');
        if (!sendConfirmed) { moderation?.stopCollection(); return failure('confirmationRequired'); }
        const controller = new AbortController();
        inflight = { requestId: message.requestId as string, controller, binding: current };
        if (cancelled.has(inflight.requestId) || generation !== credentialGeneration || selectedGeneration !== bindingGeneration) controller.abort();
        try {
          const result: Result<ResolvedVideo | ChatPage> = message.type === 'youtube.resolve'
            ? await client.resolveVideo(current.videoId, key, controller.signal)
            : await client.listMessages(current.liveChatId!, message.pageToken as string | undefined, key, controller.signal);
          const nextInterval = result.ok && 'pollingIntervalMillis' in result.value ? Math.max(DEFAULT_INTERVAL_MILLIS, result.value.pollingIntervalMillis) : interval;
          const wait = !result.ok ? result.error.retryAfterMillis ?? 0 : 0;
          const nextNotBefore = now() + Math.max(nextInterval, wait);
          const latestCooldown = (await session.get([COOLDOWN]))[COOLDOWN];
          const previousDeadline = object(latestCooldown) && typeof latestCooldown.notBefore === 'number' && Number.isFinite(latestCooldown.notBefore)
            ? latestCooldown.notBefore : 0;
          const isFresh = () => currentEpoch() && !staleCollection() && !controller.signal.aborted
            && selectedGeneration === bindingGeneration && generation === credentialGeneration;
          const fresh = isFresh();
          await session.set({ [COOLDOWN]: { interval: fresh ? nextInterval : Math.max(interval, nextInterval),
            // A stale response may extend a lease, never shorten it to the ordinary interval.
            notBefore: fresh ? nextNotBefore : Math.max(previousDeadline, nextNotBefore) } });
          // Storage can commit after navigation invalidates the pre-write snapshot.
          // The API queue remains held until this conservative restoration completes.
          if (fresh && !isFresh()) await session.set({ [COOLDOWN]: { interval: Math.max(interval, nextInterval),
            notBefore: Math.max(previousDeadline, nextNotBefore) } });
          if (!currentEpoch()) return failure('aborted');
          if (controller.signal.aborted || generation !== credentialGeneration || key !== await readApiKey()) return failure('aborted');
          return await stateExclusive(async () => {
            const latest = await binding();
            if (!currentEpoch() || controller.signal.aborted || selectedGeneration !== bindingGeneration || !latest
              || latest.monitorTabId !== current.monitorTabId || latest.targetTabId !== current.targetTabId
              || latest.videoId !== current.videoId) return failure('aborted');
            const invalidScope = result.ok && 'liveChatId' in result.value && !validAuthor(result.value.broadcasterChannelId);
            if (!result.ok || invalidScope) {
              resumeJev = false; collectionPaused = true; moderation?.stopCollection();
              await session.set({ [PAUSED]: true });
              return invalidScope ? failure('invalidResponse') : result;
            }
            if (result.ok && 'liveChatId' in result.value) {
              if (!validAuthor(result.value.broadcasterChannelId)) return failure('invalidResponse');
              await hiddenAuthors?.migrate(current.videoId, result.value.broadcasterChannelId,
                () => currentEpoch() && !controller.signal.aborted && selectedGeneration === bindingGeneration && !staleCollection());
              await hiddenAuthors?.rememberVideo(current.videoId, result.value.broadcasterChannelId,
                () => currentEpoch() && !controller.signal.aborted && selectedGeneration === bindingGeneration && !staleCollection());
              if (!currentEpoch() || controller.signal.aborted || selectedGeneration !== bindingGeneration || staleCollection()) return failure('aborted');
              await session.set({ [BINDING]: { ...latest, liveChatId: result.value.liveChatId, broadcasterChannelId: result.value.broadcasterChannelId } });
              await notify({ type: 'hidden.scopeChanged' });
            }
            if (!currentEpoch() || controller.signal.aborted || selectedGeneration !== bindingGeneration || generation !== credentialGeneration) return failure('aborted');
            if (result.ok && 'liveChatId' in result.value) {
              if (!currentEpoch() || staleCollection()) return failure('aborted');
              const resume = resumeJev; resumeJev = false;
              if (resume) await moderation?.enable();
              if (!currentEpoch() || staleCollection() || selectedGeneration !== bindingGeneration) return failure('aborted');
              return { ok: true, value: { ...result.value, jevEnabled: moderation?.isEnabled() === true } };
            }
            if (result.ok && 'messages' in result.value) {
              const collection = selectedCollection;
              if (collection !== collectionGeneration || !validAuthor(current.broadcasterChannelId)) return failure('aborted');
              if (hiddenAuthors) for (const post of result.value.messages) {
                if (validAuthor(post.authorChannelId) && !observations.has(post.id)) observations.set(post.id, {
                  video: current.videoId, channel: current.broadcasterChannelId, author: post.authorChannelId, revision: await hiddenAuthors.revision(current.broadcasterChannelId, post.authorChannelId), generation: collection,
                  nameSequence: 0,
                });
                const observed = observations.get(post.id);
                if (observed && observed.author === post.authorChannelId && observed.video === current.videoId
                  && observed.generation === collection && validDisplayName(post.authorDisplayName)) {
                  observed.displayName = post.authorDisplayName; observed.nameSequence = ++nameSequence;
                  await hiddenAuthors.updateDisplayName(observed.channel, observed.author, observed.revision, post.authorDisplayName,
                    () => currentEpoch() && !controller.signal.aborted && selectedGeneration === bindingGeneration && collection === collectionGeneration
                      && observations.get(post.id) === observed && observed.generation === collection);
                }
              }
              if (controller.signal.aborted || selectedGeneration !== bindingGeneration || generation !== credentialGeneration || collection !== collectionGeneration) return failure('aborted');
              const bursts = moderation?.observe(result.value.messages) ?? [];
              if (hiddenAuthors) for (const post of bursts) {
                const observed = observations.get(post.id);
                if (!await readConfirmation()) return failure('confirmationRequired');
                if (observed) await hiddenAuthors.add(observed.channel, observed.author, observed.revision,
                  () => currentEpoch() && !controller.signal.aborted && selectedGeneration === bindingGeneration && collection === collectionGeneration && observations.get(post.id) === observed,
                  latestDisplayName(observed), { text: post.text, videoId: observed.video });
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
  return { async handle(message: unknown, sender: MessageSender) {
    const epoch = targetEpoch;
    const result = await handle(message, sender);
    if (epoch !== targetEpoch && object(result) && result.ok === false && object(result.error) && result.error.code === 'aborted') {
      return targetPending();
    }
    return result;
  }, credentialsChanged, targetChanged, targetUpdated, clearHiddenData, confirmationChanged, stopJev,
  targetEpoch: () => changingTarget ? undefined : targetEpoch };
}
