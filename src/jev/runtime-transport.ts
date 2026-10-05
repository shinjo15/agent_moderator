import type { runtime } from '../extension-runtime';
import type { Evaluation, JevError } from './contracts';
import type { ModerationResult } from './moderation';
import { categories, decide, type Values } from './policy';
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const errors = ['missingKey', 'auth', 'validation', 'rateLimited', 'overloaded', 'network', 'invalidResponse', 'aborted', 'api'];
function error(value: unknown): JevError {
  if (!object(value) || !errors.includes(String(value.code))) return { code: 'network' };
  return { code: value.code as JevError['code'], ...(typeof value.retryAfterMillis === 'number' && Number.isFinite(value.retryAfterMillis) && value.retryAfterMillis >= 0 ? { retryAfterMillis: value.retryAfterMillis } : {}) };
}
function evaluation(value: unknown): Evaluation | undefined {
  if (!object(value) || typeof value.model !== 'string' || !value.model.trim() || !object(value.values) || !object(value.usage)) return undefined;
  const values = {} as Values;
  if (Object.keys(value.values).length !== categories.length) return undefined;
  for (const key of categories) {
    const score = value.values[key];
    if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1) return undefined;
    values[key] = score;
  }
  const { input_tokens, output_tokens } = value.usage;
  if (typeof input_tokens !== 'number' || typeof output_tokens !== 'number' || !Number.isSafeInteger(input_tokens)
    || !Number.isSafeInteger(output_tokens) || input_tokens < 0 || output_tokens < 0) return undefined;
  return { values, model: value.model, usage: { input_tokens, output_tokens } };
}
export function createModerationTransport(channel: Pick<typeof runtime, 'sendMessage'>) {
  return {
    async enable(): Promise<{ ok: true } | { ok: false; error: JevError }> {
      try {
        const response = await channel.sendMessage({ type: 'jev.enable' });
        return object(response) && response.ok === true ? { ok: true } : { ok: false, error: error(object(response) ? response.error : undefined) };
      } catch { return { ok: false, error: { code: 'network' } }; }
    },
    async stop(collection = false) { try { await channel.sendMessage({ type: collection ? 'jev.stopCollection' : 'jev.disable' }); } catch { /* Worker unavailable, no retry. */ } },
    async evaluate(id: string, authorChannelId: string): Promise<ModerationResult | undefined> {
      try {
        const response = await channel.sendMessage({ type: 'jev.evaluate', id });
        if (!object(response) || response.ok !== true || !object(response.value)) return undefined;
        const value = response.value;
        if (value.id !== id || value.authorChannelId !== authorChannelId || !['confirmed', 'notObserved', 'unavailable'].includes(String(value.burst))
          || !['evaluated', 'disabled', 'unjudged', 'failed'].includes(String(value.jev))
          || (value.malicious !== undefined && typeof value.malicious !== 'boolean') || !Array.isArray(value.reasons)
          || !value.reasons.every(reason => reason === 'burst' || categories.includes(reason))) return undefined;
        const evaluated = value.jev === 'evaluated' ? evaluation(value.evaluation) : undefined;
        if (value.jev === 'evaluated' && !evaluated) return undefined;
        const expected = evaluated ? decide(evaluated.values) : { malicious: undefined as boolean | undefined, reasons: [] as ModerationResult['reasons'] };
        const reasons: ModerationResult['reasons'] = [...expected.reasons];
        if (value.burst === 'confirmed') { expected.malicious = true; reasons.push('burst'); }
        const actualReasons = value.reasons;
        if (value.malicious !== expected.malicious || actualReasons.length !== reasons.length || !reasons.every((reason, i) => actualReasons[i] === reason)) return undefined;
        return { id, authorChannelId, burst: value.burst as ModerationResult['burst'], jev: value.jev as ModerationResult['jev'],
          malicious: value.malicious as boolean | undefined, reasons: value.reasons as ModerationResult['reasons'],
          ...(evaluated ? { evaluation: evaluated } : {}),
          ...(value.jev === 'failed' ? { error: error(value.error) } : {}) };
      } catch { return undefined; }
    },
  };
}
