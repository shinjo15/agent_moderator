import { createBoundedQueue } from '../retention';
import { validChannelId, validDisplayName } from '../youtube/contracts';
type Storage = { get(keys: string[]): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void>;
  remove?(keys: string[]): Promise<void> };
type State = { ids: string[]; revisions: Record<string, number>; displayNames: Record<string, string>; migratedVideos?: string[] };
export type HiddenAuthor = { authorChannelId: string; displayName?: string };
export const validVideo = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
export const validAuthor = validChannelId;
export function createHiddenAuthors({ storage, initialize }: { storage: Storage; initialize(): Promise<void> }) {
  const exclusive = createBoundedQueue();
  let epoch = 0;
  let clearing = false;
  // Chrome supports null to enumerate all keys. Keep ordinary readers' narrow contract.
  const all = () => (storage.get as (keys: string[] | null) => Promise<Record<string, unknown>>)(null);
  const hiddenKeys = (values: Record<string, unknown>) => Object.keys(values).filter(key => key.startsWith('hiddenAuthors.'));
  function key(channel: string) { if (!validAuthor(channel)) throw new Error('Invalid broadcaster'); return `hiddenAuthors.channel.${channel}`; }
  function scopeKey(video: string) { if (!validVideo(video)) throw new Error('Invalid video'); return `hiddenAuthors.scope.${video}`; }
  async function savedChannel(video: string) {
    await initialize();
    const value = (await storage.get([scopeKey(video)]))[scopeKey(video)];
    if (value === undefined) return undefined;
    if (!validChannelId(value)) throw new Error('Invalid saved broadcaster');
    return value;
  }
  function parse(value: unknown): State {
    const state = value as Partial<State> | undefined;
    if (value === undefined) return { ids: [], revisions: {}, displayNames: {} };
    if (!state || Array.isArray(state) || !Array.isArray(state.ids) || !state.ids.every(validAuthor)
      || typeof state.revisions !== 'object' || state.revisions === null || Array.isArray(state.revisions)
      || !Object.entries(state.revisions).every(([id, n]) => validAuthor(id) && Number.isSafeInteger(n) && n >= 0)
      || (state.migratedVideos !== undefined && (!Array.isArray(state.migratedVideos) || !state.migratedVideos.every(validVideo)))) throw new Error('Invalid hidden state');
    const ids = state.ids.filter(validAuthor); const retained = new Set(ids);
    const names = state.displayNames;
    return { ids, revisions: Object.fromEntries(Object.entries(state.revisions).filter(([id, n]) => validAuthor(id) && Number.isSafeInteger(n) && n >= 0)),
      displayNames: Object.fromEntries(names && typeof names === 'object' && !Array.isArray(names)
        ? Object.entries(names).filter(([id, name]) => retained.has(id) && validDisplayName(name)) : []),
      ...(Array.isArray(state.migratedVideos) ? { migratedVideos: state.migratedVideos.filter(validVideo) } : {}) };
  }
  async function read(channel: string): Promise<State> {
    await initialize();
    return parse((await storage.get([key(channel)]))[key(channel)]);
  }
  return {
    channelForVideo(video: string) { return exclusive(() => savedChannel(video)); },
    rememberVideo(video: string, channel: string, current = () => true) {
      const selectedEpoch = epoch; const writable = !clearing;
      return exclusive(async () => {
        await initialize();
        if (!validChannelId(channel)) throw new Error('Invalid broadcaster');
        if (!writable || clearing || selectedEpoch !== epoch || !current()) return;
        await storage.set({ [scopeKey(video)]: channel });
        if (await savedChannel(video) !== channel) throw new Error('Scope write not verified');
      });
    },
    forgetVideo(video: string, current = () => true) {
      const selectedEpoch = epoch; const writable = !clearing;
      return exclusive(async () => {
        await initialize();
        if (!writable || clearing || selectedEpoch !== epoch || !current()) return;
        if (!storage.remove) throw new Error('Deletion unavailable');
        await storage.remove([scopeKey(video)]);
        if ((await storage.get([scopeKey(video)]))[scopeKey(video)] !== undefined) throw new Error('Scope deletion not verified');
      });
    },
    migrate(video: string, channel: string, current = () => true) {
      const selectedEpoch = epoch; const writable = !clearing;
      return exclusive(async () => {
        if (!validVideo(video)) throw new Error('Invalid video');
        const state = await read(channel);
        const legacyKey = `hiddenAuthors.${video}`;
        const legacy = (await storage.get([legacyKey]))[legacyKey];
        if (legacy === undefined || !writable || clearing || selectedEpoch !== epoch || !current()) return;
        if (!state.migratedVideos?.includes(video)) {
          const previous = parse(legacy);
          for (const author of previous.ids) {
            // A positive channel revision is also a permanent legacy tombstone.
            // Fresh observations may still add using that current revision.
            if ((state.revisions[author] ?? 0) > 0 || state.ids.includes(author)) continue;
            state.ids.push(author);
            if (previous.displayNames[author] !== undefined) state.displayNames[author] = previous.displayNames[author];
          }
          // Old video clocks have no shared order. Preserve removal protection,
          // but never overwrite a current channel entry or copy/max those clocks.
          for (const [author, revision] of Object.entries(previous.revisions)) {
            if (revision > 0 && !previous.ids.includes(author) && !state.ids.includes(author)) state.revisions[author] = Math.max(1, state.revisions[author] ?? 0);
          }
          state.migratedVideos = [...state.migratedVideos ?? [], video];
          await storage.set({ [key(channel)]: state });
        }
        // Acknowledgement alone must never authorize destroying the only copy.
        // Check the existing marker path too, including its removal revisions.
        if (JSON.stringify(await read(channel)) !== JSON.stringify(state)) throw new Error('Migration write not verified');
        if (!writable || clearing || selectedEpoch !== epoch || !current()) return;
        if (!storage.remove) throw new Error('Deletion unavailable');
        await storage.remove([legacyKey]);
        if ((await storage.get([legacyKey]))[legacyKey] !== undefined) throw new Error('Migration cleanup not verified');
      });
    },
    list(channel: string) { return exclusive(async () => (await read(channel)).ids); },
    epoch: () => epoch,
    isCurrent: (selectedEpoch: number) => !clearing && selectedEpoch === epoch,
    clearAll() {
      if (clearing) return Promise.reject(new Error('Deletion in progress'));
      epoch++; clearing = true;
      return exclusive(async () => {
        await initialize();
        if (!storage.remove) throw new Error('Deletion unavailable');
        const keys = hiddenKeys(await all());
        if (keys.length) await storage.remove(keys);
        if (hiddenKeys(await all()).length) throw new Error('Deletion not verified');
      }).finally(() => { clearing = false; });
    },
    listAuthors(channel: string): Promise<HiddenAuthor[]> { return exclusive(async () => {
      const state = await read(channel);
      return state.ids.map(authorChannelId => ({ authorChannelId,
        ...(state.displayNames[authorChannelId] === undefined ? {} : { displayName: state.displayNames[authorChannelId] }) }));
    }); },
    revision(channel: string, author: string) { return exclusive(async () => { if (!validAuthor(author)) throw new Error('Invalid author'); return (await read(channel)).revisions[author] ?? 0; }); },
    add(channel: string, author: string, revision: number, current = () => true, displayName?: string) {
      const selectedEpoch = epoch; const writable = !clearing;
      return exclusive(async () => {
        if (!validAuthor(author)) throw new Error('Invalid author');
        const state = await read(channel);
        if (!writable || clearing || selectedEpoch !== epoch || !current() || (state.revisions[author] ?? 0) !== revision || state.ids.includes(author)) return;
        state.ids.push(author);
        if (validDisplayName(displayName)) state.displayNames[author] = displayName;
        await storage.set({ [key(channel)]: state });
      });
    },
    updateDisplayName(channel: string, author: string, revision: number, displayName: string, current = () => true) {
      const selectedEpoch = epoch; const writable = !clearing;
      return exclusive(async () => {
        if (!validAuthor(author)) throw new Error('Invalid author');
        if (!validDisplayName(displayName)) return;
        const state = await read(channel);
        if (!writable || clearing || selectedEpoch !== epoch || !current() || (state.revisions[author] ?? 0) !== revision || !state.ids.includes(author)
          || state.displayNames[author] === displayName) return;
        state.displayNames[author] = displayName;
        await storage.set({ [key(channel)]: state });
      });
    },
    remove(channel: string, author: string, requireHidden = false, current: () => boolean | Promise<boolean> = () => true) {
      const selectedEpoch = epoch; const writable = !clearing;
      return exclusive(async () => {
        if (!validAuthor(author)) throw new Error('Invalid author');
        const state = await read(channel);
        const authorized = await current();
        if (!authorized || !writable || clearing || selectedEpoch !== epoch) return;
        // A stale UI button must not recreate revision-only records after global deletion.
        if (requireHidden && !state.ids.includes(author)) return;
        state.ids = state.ids.filter(id => id !== author);
        delete state.displayNames[author];
        state.revisions[author] = (state.revisions[author] ?? 0) + 1;
        await storage.set({ [key(channel)]: state });
      });
    },
  };
}
