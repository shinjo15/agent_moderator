import { createBoundedQueue } from '../retention';
type Storage = { get(keys: string[]): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void> };
type State = { ids: string[]; revisions: Record<string, number> };
export const validVideo = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value);
export const validAuthor = (value: unknown): value is string => typeof value === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(value);
export function createHiddenAuthors({ storage, initialize }: { storage: Storage; initialize(): Promise<void> }) {
  const exclusive = createBoundedQueue();
  function key(video: string) { if (!validVideo(video)) throw new Error('Invalid video'); return `hiddenAuthors.${video}`; }
  async function read(video: string): Promise<State> {
    await initialize();
    const value = (await storage.get([key(video)]))[key(video)] as Partial<State> | undefined;
    if (!value || !Array.isArray(value.ids) || typeof value.revisions !== 'object' || value.revisions === null) return { ids: [], revisions: {} };
    return { ids: value.ids.filter(validAuthor), revisions: Object.fromEntries(Object.entries(value.revisions).filter(([id, n]) => validAuthor(id) && Number.isSafeInteger(n) && n >= 0)) };
  }
  return {
    list(video: string) { return exclusive(async () => (await read(video)).ids); },
    revision(video: string, author: string) { return exclusive(async () => { if (!validAuthor(author)) throw new Error('Invalid author'); return (await read(video)).revisions[author] ?? 0; }); },
    add(video: string, author: string, revision: number, current = () => true) {
      return exclusive(async () => {
        if (!validAuthor(author)) throw new Error('Invalid author');
        const state = await read(video);
        if (!current() || (state.revisions[author] ?? 0) !== revision || state.ids.includes(author)) return;
        state.ids.push(author); await storage.set({ [key(video)]: state });
      });
    },
    remove(video: string, author: string) {
      return exclusive(async () => {
        if (!validAuthor(author)) throw new Error('Invalid author');
        const state = await read(video); state.ids = state.ids.filter(id => id !== author);
        state.revisions[author] = (state.revisions[author] ?? 0) + 1;
        await storage.set({ [key(video)]: state });
      });
    },
  };
}
