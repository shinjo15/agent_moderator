import type { EvaluationState, JevClient, JevResult } from './contracts';
import { categories, questions, type Values } from './policy';
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export function createJevClient(fetcher: typeof fetch = fetch): JevClient {
  return { async evaluate(state: EvaluationState, key: string, signal: AbortSignal): Promise<JevResult> {
    if (signal.aborted) return { ok: false, error: { code: 'aborted' } };
    if (!key) return { ok: false, error: { code: 'missingKey' } };
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 20000);
    try {
    const response = await fetcher('https://api.typesafe.ai/v1/systemone', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
      body: JSON.stringify({ model: 'jev-latest', state, questions }),
    });
    if (!response.ok) {
      const code = response.status === 401 ? 'auth' : response.status === 422 ? 'validation'
        : response.status === 429 ? 'rateLimited' : response.status === 529 ? 'overloaded' : 'api';
      const header = response.headers.get('Retry-After');
      const delay = header === null ? NaN : /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now();
      return { ok: false, error: { code, ...((code === 'rateLimited' || code === 'overloaded') && Number.isFinite(delay) && delay >= 0 ? { retryAfterMillis: delay } : {}) } };
    }
    let body: unknown;
    try { body = await response.json(); } catch { return { ok: false, error: { code: signal.aborted ? 'aborted' : controller.signal.aborted ? 'network' : 'invalidResponse' } }; }
    if (signal.aborted || controller.signal.aborted) return { ok: false, error: { code: signal.aborted ? 'aborted' : 'network' } };
    if (!object(body) || typeof body.model !== 'string' || !body.model.trim() || !object(body.answers) || !object(body.usage)) return { ok: false, error: { code: 'invalidResponse' } };
    const values = {} as Values;
    if (Object.keys(body.answers).length !== categories.length) return { ok: false, error: { code: 'invalidResponse' } };
    for (const key of categories) {
      const answer = body.answers[key];
      if (!object(answer) || answer.type !== 'noul' || typeof answer.noul !== 'number' || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) return { ok: false, error: { code: 'invalidResponse' } };
      values[key] = answer.noul;
    }
    if (!Number.isSafeInteger(body.usage.input_tokens) || !Number.isSafeInteger(body.usage.output_tokens) || (body.usage.input_tokens as number) < 0 || (body.usage.output_tokens as number) < 0) return { ok: false, error: { code: 'invalidResponse' } };
    return { ok: true, value: { values, model: body.model, usage: { input_tokens: body.usage.input_tokens as number, output_tokens: body.usage.output_tokens as number } } };
    } catch { return { ok: false, error: { code: signal.aborted ? 'aborted' : 'network' } }; }
    finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
  } };
}
