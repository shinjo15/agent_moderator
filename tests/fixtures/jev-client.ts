import { readFileSync } from 'node:fs';
import { createJevClient as createClient } from '../../src/jev/client';
import type { Questions } from '../../src/jev/contracts';
export const questions: Questions = JSON.parse(readFileSync('public/jev-questions.json', 'utf8'));
// Existing fixtures bypass only local file I/O; the HTTP client and moderation remain real.
export function createJevClient(fetcher?: typeof fetch) {
  const client = createClient(fetcher, async () => structuredClone(questions));
  return { ...client, evaluate: (state: Parameters<typeof client.evaluate>[0], key: string, signal: AbortSignal, definition = questions) => client.evaluate(state, key, signal, definition) };
}
