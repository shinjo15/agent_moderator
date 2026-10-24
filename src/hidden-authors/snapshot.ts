import { validAuthor, type HiddenAuthor } from './store';
import { validDisplayName } from '../youtube/contracts';
export type HiddenSnapshot = { status: 'loading' | 'ready' | 'error'; authors: HiddenAuthor[] };
// Only a current, validated storage read can authorize showing a comment. Evaluation
// responses are deliberately not an input: removals carry their own store revision.
export function createHiddenAuthorSnapshot({ read, changed }: {
  read(video: string): Promise<unknown>; changed(state: HiddenSnapshot): void;
}) {
  let video: string | undefined;
  let generation = 0;
  let reading: number | undefined;
  let state: HiddenSnapshot = { status: 'loading', authors: [] };
  const publish = (next: HiddenSnapshot) => { state = next; changed(next); };
  async function refresh(block = state.status !== 'ready') {
    const selected = video; const current = ++generation;
    if (block) publish({ ...state, status: 'loading' });
    if (!selected) return;
    reading = current;
    try {
      const value = await read(selected) as { ok?: boolean; videoId?: unknown; ids?: unknown; authors?: unknown };
      if (current !== generation) return;
      if (value?.ok !== true || value.videoId !== selected || !Array.isArray(value.ids) || !value.ids.every(validAuthor)) throw new Error('Invalid snapshot');
      const ids: string[] = value.ids;
      const authors: HiddenAuthor[] = ids.map(authorChannelId => ({ authorChannelId }));
      if (value.authors !== undefined) {
        if (!Array.isArray(value.authors) || value.authors.length !== ids.length) throw new Error('Invalid authors');
        for (let i = 0; i < authors.length; i++) {
          const author = value.authors[i] as HiddenAuthor | null;
          if (!author || typeof author !== 'object' || Array.isArray(author) || author.authorChannelId !== ids[i]
            || (author.displayName !== undefined && !validDisplayName(author.displayName))) throw new Error('Invalid author');
          if (author.displayName !== undefined) authors[i].displayName = author.displayName;
        }
      }
      publish({ status: 'ready', authors });
    } catch { if (current === generation) publish({ ...state, status: 'error' }); }
    finally { if (reading === current) reading = undefined; }
  }
  return {
    state: () => state,
    visible: (author: string) => state.status === 'ready' && !state.authors.some(value => value.authorChannelId === author),
    refresh,
    poll() { if (reading === undefined) return refresh(false); },
    setVideo(value: string | undefined) { video = value; state = { status: 'loading', authors: [] }; return refresh(); },
  };
}
