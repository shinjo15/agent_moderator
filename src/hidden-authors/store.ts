import { createBoundedQueue } from '../retention';
import { validDisplayName } from '../youtube/contracts';
type Storage = { get(keys: string[]): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void>;
  remove?(keys: string[]): Promise<void> };
type State = { ids: string[]; revisions: Record<string, number>; displayNames: Record<string, string> };
export type HiddenAuthor = { authorChannelId: string; displayName?: string };
export const validVideo = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
export const validAuthor = (value: unknown): value is string => typeof value === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(value);
export function createHiddenAuthors({ storage, initialize }: { storage: Storage; initialize(): Promise<void> }) {
  const exclusive = createBoundedQueue();
  let epoch = 0;
  let clearing = false;
  // Chrome supports null to enumerate all keys. Keep ordinary readers' narrow contract.
  const all = () => (storage.get as (keys: string[] | null) => Promise<Record<string, unknown>>)(null);
  const hiddenKeys = (values: Record<string, unknown>) => Object.keys(values).filter(key => key.startsWith('hiddenAuthors.'));
  function key(video: string) { if (!validVideo(video)) throw new Error('Invalid video'); return `hiddenAuthors.${video}`; }
  async function read(video: string): Promise<State> {
    await initialize();
    const value = (await storage.get([key(video)]))[key(video)] as Partial<State> | undefined;
    if (!value || !Array.isArray(value.ids) || typeof value.revisions !== 'object' || value.revisions === null) return { ids: [], revisions: {}, displayNames: {} };
    const ids = value.ids.filter(validAuthor); const retained = new Set(ids);
    const names = value.displayNames;
    return { ids, revisions: Object.fromEntries(Object.entries(value.revisions).filter(([id, n]) => validAuthor(id) && Number.isSafeInteger(n) && n >= 0)),
      displayNames: Object.fromEntries(names && typeof names === 'object' && !Array.isArray(names)
        ? Object.entries(names).filter(([id, name]) => retained.has(id) && validDisplayName(name)) : []) };
  }
  return {
    list(video: string) { return exclusive(async () => (await read(video)).ids); },
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
    listAuthors(video: string): Promise<HiddenAuthor[]> { return exclusive(async () => {
      const state = await read(video);
      return state.ids.map(authorChannelId => ({ authorChannelId,
        ...(state.displayNames[authorChannelId] === undefined ? {} : { displayName: state.displayNames[authorChannelId] }) }));
    }); },
    revision(video: string, author: string) { return exclusive(async () => { if (!validAuthor(author)) throw new Error('Invalid author'); return (await read(video)).revisions[author] ?? 0; }); },
    add(video: string, author: string, revision: number, current = () => true, displayName?: string) {
      const selectedEpoch = epoch; const writable = !clearing;
      return exclusive(async () => {
        if (!validAuthor(author)) throw new Error('Invalid author');
        const state = await read(video);
        if (!writable || clearing || selectedEpoch !== epoch || !current() || (state.revisions[author] ?? 0) !== revision || state.ids.includes(author)) return;
        state.ids.push(author);
        if (validDisplayName(displayName)) state.displayNames[author] = displayName;
        await storage.set({ [key(video)]: state });
      });
    },
    updateDisplayName(video: string, author: string, revision: number, displayName: string, current = () => true) {
      const selectedEpoch = epoch; const writable = !clearing;
      return exclusive(async () => {
        if (!validAuthor(author)) throw new Error('Invalid author');
        if (!validDisplayName(displayName)) return;
        const state = await read(video);
        if (!writable || clearing || selectedEpoch !== epoch || !current() || (state.revisions[author] ?? 0) !== revision || !state.ids.includes(author)
          || state.displayNames[author] === displayName) return;
        state.displayNames[author] = displayName;
        await storage.set({ [key(video)]: state });
      });
    },
    remove(video: string, author: string, requireHidden = false) {
      const selectedEpoch = epoch; const writable = !clearing;
      return exclusive(async () => {
        if (!validAuthor(author)) throw new Error('Invalid author');
        const state = await read(video);
        if (!writable || clearing || selectedEpoch !== epoch) return;
        // A stale UI button must not recreate revision-only records after global deletion.
        if (requireHidden && !state.ids.includes(author)) return;
        state.ids = state.ids.filter(id => id !== author);
        delete state.displayNames[author];
        state.revisions[author] = (state.revisions[author] ?? 0) + 1;
        await storage.set({ [key(video)]: state });
      });
    },
  };
}
