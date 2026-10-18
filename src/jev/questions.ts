import type { Questions } from './contracts';
import { categories } from './policy';
import type { runtime as extensionRuntime } from '../extension-runtime';
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key));
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
function valid(value: unknown): value is Questions {
  return object(value) && exact(value, categories) && categories.every(key => {
    const question = value[key];
    return object(question) && exact(question, ['type', 'instructions', 'criteria']) && question.type === 'noul'
      && text(question.instructions) && object(question.criteria) && exact(question.criteria, ['true', 'false'])
      && text(question.criteria.true) && text(question.criteria.false);
  });
}
export async function loadQuestions(signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Questions> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(abort, 20000);
  let rejectAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(new Error('Invalid Jev definition'));
    controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try {
    if (controller.signal.aborted) throw new Error('Invalid Jev definition');
    return await Promise.race([aborted, (async () => {
      const runtime = (globalThis as unknown as { chrome: { runtime: typeof extensionRuntime } }).chrome.runtime;
      const response = await fetcher(runtime.getURL('jev-questions.json'), {
        credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) throw new Error('Invalid Jev definition');
      const value: unknown = await response.json();
      if (controller.signal.aborted || !valid(value)) throw new Error('Invalid Jev definition');
      return value;
    })()]);
  } catch { throw new Error('Invalid Jev definition'); }
  finally {
    clearTimeout(timeout); signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', rejectAbort);
  }
}
