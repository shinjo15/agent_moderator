import type { ChatMessage } from '../youtube/contracts';
import { publicationTime } from '../youtube/published-at';
import type { EvaluationState, Post } from './contracts';
import { createTransientMap } from '../retention';
export type Context = { state: EvaluationState; burst: 'confirmed' | 'notObserved' | 'unavailable' };
const minimal = (message: ChatMessage): Post => ({ text: message.text,
  ...(publicationTime(message.publishedAt) === undefined ? {} : { publishedAt: message.publishedAt }) });
export function createHistory({ now = Date.now }: { now?: () => number } = {}) {
  type Entry = { id: string; author: string; post: Post; time?: bigint };
  const authors = new Map<string, Entry[]>();
  const byId = new Map<string, Entry>();
  // Time-only evidence is separate from the 20-body context window.
  const times = new Map<string, { id: string; time: bigint }[]>();
  const seen = createTransientMap<string>({ now, onDelete(id, author) {
    retain(author, (authors.get(author) ?? []).filter(entry => entry.id !== id));
    const retained = (times.get(author) ?? []).filter(entry => entry.id !== id);
    if (retained.length) times.set(author, retained); else times.delete(author);
    if (!times.size) watermark = undefined;
  } });
  let watermark: bigint | undefined;
  const window = 60000000000n;
  function retain(author: string, entries: Entry[]) {
    for (const entry of authors.get(author) ?? []) byId.delete(entry.id);
    if (entries.length) authors.set(author, entries); else authors.delete(author);
    for (const entry of entries) byId.set(entry.id, entry);
  }
  function context(id: string): EvaluationState | undefined {
    seen.sweep();
    const target = byId.get(id);
    if (!target) return undefined;
    const previous = (authors.get(target.author) ?? []).filter(entry => entry.id !== id && entry.time !== undefined
      && target.time !== undefined && entry.time <= target.time && target.time - entry.time <= window);
    return { target: target.post, history: previous.slice(-19).map(entry => entry.post) };
  }
  function clearBodies() { authors.clear(); byId.clear(); times.clear(); watermark = undefined; }
  return {
    context, clearBodies,
    clear() { seen.clear(); clearBodies(); },
    add(message: ChatMessage): Context | undefined {
      if (seen.has(message.id)) return undefined;
      if (!seen.set(message.id, message.authorChannelId)) return undefined;
      const time = publicationTime(message.publishedAt);
      const target = minimal(message);
      if (time === undefined) {
        retain(message.authorChannelId, [...(authors.get(message.authorChannelId) ?? []).filter(entry => entry.time !== undefined),
          { id: message.id, author: message.authorChannelId, post: target }].slice(-20));
        return { state: { target, history: [] }, burst: 'unavailable' };
      }
      watermark = watermark === undefined || time > watermark ? time : watermark;
      for (const [author, posts] of authors) {
        retain(author, posts.filter(post => post.time !== undefined && post.time >= watermark! - window));
      }
      for (const [author, values] of times) {
        const retained = values.filter(entry => entry.time >= watermark! - window);
        if (retained.length) times.set(author, retained); else times.delete(author);
      }
      if (time < watermark - window) return { state: { target, history: [] }, burst: 'unavailable' };
      const retained = authors.get(message.authorChannelId) ?? [];
      const previous = retained.filter(post => post.time !== undefined && post.time <= time && time - post.time <= window);
      const timestamps = times.get(message.authorChannelId) ?? [];
      const count = timestamps.filter(entry => entry.time <= time && time - entry.time <= 10000000000n).length + 1;
      times.set(message.authorChannelId, [...timestamps, { id: message.id, time }]);
      retain(message.authorChannelId, [...retained, { id: message.id, author: message.authorChannelId, post: target, time }].sort((a, b) => a.time! < b.time! ? -1 : a.time! > b.time! ? 1 : 0).slice(-20));
      return { state: { target, history: previous.slice(-19).map(entry => entry.post) },
        burst: count >= 10 ? 'confirmed' : 'notObserved' };
    },
  };
}
