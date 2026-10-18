import { expect, it, vi } from 'vitest';
import { createJevClient } from '../src/jev/client';
import { createModeration } from '../src/jev/moderation';
import { chatPost } from './fixtures/jev';
import { questions } from './fixtures/jev-client';

it.each([
  ['missing', (v: Record<string, unknown>) => { delete v.attack; }],
  ['extra category', (v: Record<string, unknown>) => { v.other = v.attack; }],
  ['wrong type', (v: Record<string, unknown>) => { (v.attack as Record<string, unknown>).type = 'score'; }],
  ['empty instructions', (v: Record<string, unknown>) => { (v.attack as Record<string, unknown>).instructions = '  '; }],
  ['non-string instructions', (v: Record<string, unknown>) => { (v.attack as Record<string, unknown>).instructions = 123; }],
  ['empty criteria', (v: Record<string, unknown>) => { (v.attack as Record<string, unknown>).criteria = { true: '', false: 'no' }; }],
  ['missing criteria', (v: Record<string, unknown>) => { (v.attack as Record<string, unknown>).criteria = { true: 'yes' }; }],
  ['extra criteria', (v: Record<string, unknown>) => { (v.attack as Record<string, unknown>).criteria = { true: 'yes', false: 'no', other: 'x' }; }],
  ['extra question field', (v: Record<string, unknown>) => { (v.attack as Record<string, unknown>).url = 'https://invalid.example'; }],
  ['array', (v: Record<string, unknown>) => { v.attack = []; }],
  ['null', (v: Record<string, unknown>) => { v.attack = null; }],
  ['root URL', (v: Record<string, unknown>) => { v.endpoint = 'https://invalid.example'; }],
] as const)('定義の%sは固定エラーでJev送信0・fallbackなし', async (_name, change) => {
  const value = structuredClone(questions); change(value);
  const fetcher = vi.fn(async (_url: unknown) => new Response(JSON.stringify(value)));
  vi.stubGlobal('chrome', { runtime: { getURL: (path: string) => `chrome-extension://fixture/${path}` } });
  const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic', readConfirmation: async () => true });
  try {
    await moderation.enable(); moderation.observe([chatPost('invalid')]);
    expect(await moderation.evaluate('invalid')).toMatchObject({ ok: true, value: { jev: 'failed', error: { code: 'definition' } } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('chrome-extension://fixture/jev-questions.json');
  } finally { moderation.reset(); vi.unstubAllGlobals(); }
});

it.each(['http', 'json', 'network'] as const)('定義%s読込失敗も公開エラーだけでJev通信0', async kind => {
  const fetcher = vi.fn(async (_url: unknown) => {
    if (kind === 'network') throw new Error('synthetic-private');
    return new Response('synthetic-private', { status: kind === 'http' ? 404 : 200 });
  });
  vi.stubGlobal('chrome', { runtime: { getURL: (path: string) => `chrome-extension://fixture/${path}` } });
  const moderation = createModeration({ client: createJevClient(fetcher), readKey: async () => 'synthetic', readConfirmation: async () => true });
  try {
    await moderation.enable(); moderation.observe([chatPost('invalid')]);
    const result = await moderation.evaluate('invalid');
    expect(result).toMatchObject({ ok: true, value: { error: { code: 'definition' } } });
    expect(JSON.stringify(result)).not.toMatch(/synthetic|日本語/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally { moderation.reset(); vi.unstubAllGlobals(); }
});

it.each(['abort', 'timeout'] as const)('定義読込の%sは20秒以内に解放し、遅延JSONからPOSTへ進まない', async kind => {
  vi.useFakeTimers();
  vi.stubGlobal('chrome', { runtime: { getURL: (path: string) => `chrome-extension://fixture/${path}` } });
  try {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    const controller = new AbortController();
    const pending = createJevClient(fetcher).loadQuestions(controller.signal);
    const rejected = expect(pending).rejects.toThrow('Invalid Jev definition');
    if (kind === 'abort') controller.abort(); else await vi.advanceTimersByTimeAsync(20000);
    await rejected;
    finish(new Response(JSON.stringify(questions)));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});
