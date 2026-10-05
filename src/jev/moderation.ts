import type { ChatMessage } from '../youtube/contracts';
import type { Evaluation, JevClient, JevError } from './contracts';
import { createHistory, type Context } from './history';
import { decide, type Category } from './policy';
import type { SessionStorage } from '../youtube/background-handler';
export type ModerationResult = {
  id: string; authorChannelId: string; burst: Context['burst'];
  malicious?: boolean; reasons: (Category | 'burst')[];
  jev: 'evaluated' | 'disabled' | 'unjudged' | 'failed'; evaluation?: Evaluation; error?: JevError;
};
export function createModeration({ client, readKey, session, now = Date.now }: {
  client: JevClient; readKey: () => Promise<string | undefined>;
  session?: Pick<SessionStorage, 'get' | 'set'>; now?: () => number;
}) {
  const history = createHistory();
  const records = new Map<string, { authorChannelId: string; burst: Context['burst']; allowed: boolean; result?: ModerationResult }>();
  let enabled = false;
  let generation = 0;
  let controller: AbortController | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let notBefore = 0;
  function stop() {
    enabled = false; generation++; controller?.abort();
    for (const record of records.values()) record.allowed = false;
  }
  function reset() { stop(); history.clear(); records.clear(); }
  function stopCollection() { stop(); history.clearBodies(); }
  function observe(messages: ChatMessage[]) {
    for (const message of messages) {
      const context = history.add(message);
      if (context) records.set(message.id, { authorChannelId: message.authorChannelId, burst: context.burst, allowed: enabled });
    }
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
  async function evaluateOne(id: string, current: number) {
    if (current !== generation) return { ok: false as const, error: { code: 'aborted' as const } };
    const record = records.get(id);
    if (!record) return { ok: false as const, error: { code: 'forbidden' as const } };
    if (record.result) return { ok: true as const, value: record.result };
    const base: ModerationResult = { id, authorChannelId: record.authorChannelId, burst: record.burst, reasons: [], jev: 'disabled' };
    if (enabled && record.allowed && record.burst === 'confirmed') base.jev = 'unjudged';
    if (enabled && record.allowed && record.burst !== 'confirmed') {
      const state = history.context(id);
      if (state) {
        try {
          const key = await readKey();
          if (current !== generation) return { ok: false as const, error: { code: 'aborted' as const } };
          if (key) {
            controller = new AbortController();
            const result = await client.evaluate(state, key, controller.signal);
            // Server wait constraints survive stale results, stops and worker recreation.
            if (!result.ok && result.error.retryAfterMillis !== undefined) {
              notBefore = Math.max(notBefore, now() + result.error.retryAfterMillis);
              await session?.set({ 'jev.notBefore': notBefore });
            }
            const latestKey = await readKey();
            if (current !== generation || controller.signal.aborted) return { ok: false as const, error: { code: 'aborted' as const } };
            if (key !== latestKey) { stop(); return { ok: false as const, error: { code: 'aborted' as const } }; }
            if (result.ok) Object.assign(base, decide(result.value.values), { jev: 'evaluated', evaluation: result.value });
            else { Object.assign(base, { jev: 'failed', error: result.error }); stop(); }
          } else {
            Object.assign(base, { jev: 'failed', error: { code: 'missingKey' } }); stop();
          }
        } catch {
          if (current !== generation) return { ok: false as const, error: { code: 'aborted' as const } };
          Object.assign(base, { jev: 'failed', error: { code: 'network' } }); stop();
        }
      } else base.jev = 'unjudged';
    }
    if (record.burst === 'confirmed') { base.malicious = true; base.reasons.push('burst'); }
    record.result = base;
    return { ok: true as const, value: base };
  }
  function evaluate(id: string) {
    const current = generation;
    const result = queue.then(() => evaluateOne(id, current));
    queue = result.catch(() => {});
    return result;
  }
  return { observe, enable, evaluate, stop, stopCollection, reset };
}
