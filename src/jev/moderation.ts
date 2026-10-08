import type { ChatMessage } from '../youtube/contracts';
import type { Evaluation, JevClient, JevError } from './contracts';
import { createHistory, type Context } from './history';
import { decide, type Category } from './policy';
import type { SessionStorage } from '../youtube/background-handler';
import { createBoundedQueue, createTransientMap, MAX_PENDING_EVALUATIONS } from '../retention';
import { DEFAULT_THRESHOLD, validThreshold } from './threshold';
export type ModerationResult = {
  id: string; authorChannelId: string; burst: Context['burst'];
  malicious?: boolean; reasons: (Category | 'burst')[];
  jev: 'evaluated' | 'disabled' | 'unjudged' | 'failed'; evaluation?: Evaluation; threshold?: number; error?: JevError;
};
export function createModeration({ client, readKey, session, now = Date.now, readThreshold = async () => DEFAULT_THRESHOLD }: {
  client: JevClient; readKey: () => Promise<string | undefined>;
  session?: Pick<SessionStorage, 'get' | 'set'>; now?: () => number;
  readThreshold?: () => Promise<number>;
}) {
  const history = createHistory({ now });
  type Record = { authorChannelId: string; burst: Context['burst']; allowed: boolean; result?: ModerationResult };
  const records = createTransientMap<Record>({ now });
  let enabled = false;
  let generation = 0;
  let controller: AbortController | undefined;
  const exclusive = createBoundedQueue({ now, limit: MAX_PENDING_EVALUATIONS });
  const pending = new Map<string, ReturnType<typeof evaluateOne>>();
  let notBefore = 0;
  function stop() {
    enabled = false; generation++; controller?.abort();
    for (const record of records.values()) record.allowed = false;
  }
  function reset() { stop(); history.clear(); records.clear(); }
  function stopCollection() { stop(); history.clearBodies(); }
  function observe(messages: ChatMessage[]) {
    const bursts: ChatMessage[] = [];
    for (const message of messages) {
      const context = history.add(message);
      if (context) records.set(message.id, { authorChannelId: message.authorChannelId, burst: context.burst, allowed: enabled });
      if (context?.burst === 'confirmed') bursts.push(message);
    }
    return bursts;
  }
  async function enable() {
    const current = generation;
    try {
      const stored = (await session?.get(['jev.notBefore']))?.['jev.notBefore'];
      if (typeof stored === 'number' && Number.isFinite(stored)) notBefore = Math.max(notBefore, stored);
      if (now() < notBefore) return { ok: false as const, error: { code: 'rateLimited' as const, retryAfterMillis: notBefore - now() } };
      if (!await readKey()) return { ok: false as const, error: { code: 'missingKey' as const } };
    } catch { return { ok: false as const, error: { code: 'network' as const } }; }
    if (current !== generation) return { ok: false as const, error: { code: 'aborted' as const } };
    enabled = true;
    return { ok: true as const };
  }
  async function evaluateOne(id: string, current: number, record: Record) {
    if (current !== generation) return { ok: false as const, error: { code: 'aborted' as const } };
    if (records.get(id) !== record) return { ok: false as const, error: { code: 'forbidden' as const } };
    if (record.result) return { ok: true as const, value: record.result };
    const base: ModerationResult = { id, authorChannelId: record.authorChannelId, burst: record.burst, reasons: [], jev: 'disabled' };
    if (enabled && record.allowed && record.burst === 'confirmed') base.jev = 'unjudged';
    if (enabled && record.allowed && record.burst !== 'confirmed') {
      if (history.context(id)) {
        try {
          // Capture once at new evaluation start, not observation/enqueue/response time.
          const threshold = await readThreshold();
          if (!validThreshold(threshold)) throw new Error('Invalid filter threshold');
          if (current !== generation) return { ok: false as const, error: { code: 'aborted' as const } };
          const key = await readKey();
          if (current !== generation) return { ok: false as const, error: { code: 'aborted' as const } };
          if (records.get(id) !== record) return { ok: false as const, error: { code: 'forbidden' as const } };
          let state = history.context(id);
          if (!state) return { ok: true as const, value: { ...base, jev: 'unjudged' as const } };
          if (key && now() < notBefore) {
            Object.assign(base, { jev: 'failed', error: { code: 'rateLimited', retryAfterMillis: notBefore - now() } }); stop();
          } else if (key) {
            controller = new AbortController();
            const result = await client.evaluate(state, key, controller.signal);
            state = undefined;
            // Server wait constraints survive stale results, stops and worker recreation.
            if (!result.ok && result.error.retryAfterMillis !== undefined) {
              notBefore = Math.max(notBefore, now() + result.error.retryAfterMillis);
              await session?.set({ 'jev.notBefore': notBefore });
            }
            const latestKey = await readKey();
            if (current !== generation || controller.signal.aborted) return { ok: false as const, error: { code: 'aborted' as const } };
            // A current failure stops sending even when its observed record has expired.
            if (!result.ok) stop();
            if (result.ok && records.get(id) !== record) return { ok: false as const, error: { code: 'forbidden' as const } };
            if (key !== latestKey) { stop(); return { ok: false as const, error: { code: 'aborted' as const } }; }
            if (result.ok) Object.assign(base, decide(result.value.values, threshold), { jev: 'evaluated', evaluation: result.value, threshold });
            else Object.assign(base, { jev: 'failed', error: result.error });
          } else {
            Object.assign(base, { jev: 'failed', error: { code: 'missingKey' } }); stop();
          }
        } catch {
          if (current !== generation) return { ok: false as const, error: { code: 'aborted' as const } };
          Object.assign(base, { jev: 'failed', error: { code: 'network' } }); stop();
        }
      } else base.jev = 'unjudged';
    }
    if (records.get(id) !== record) {
      // Notify the current failure without restoring/caching expired observation data.
      if (base.jev === 'failed') return { ok: true as const, value: base };
      return { ok: false as const, error: { code: 'forbidden' as const } };
    }
    if (record.burst === 'confirmed') { base.malicious = true; base.reasons.push('burst'); }
    record.result = base;
    return { ok: true as const, value: base };
  }
  function evaluate(id: string) {
    const duplicate = pending.get(id);
    if (duplicate) return duplicate;
    const record = records.get(id);
    if (!record || pending.size >= MAX_PENDING_EVALUATIONS) return Promise.resolve({ ok: false as const, error: { code: 'forbidden' as const } });
    const current = generation;
    const result = exclusive(() => evaluateOne(id, current, record)).catch(() => ({ ok: false as const, error: { code: 'forbidden' as const } }));
    pending.set(id, result);
    void result.finally(() => pending.delete(id));
    return result;
  }
  return { observe, enable, evaluate, stop, stopCollection, reset };
}
