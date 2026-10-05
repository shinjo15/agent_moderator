import { expect, it, vi } from 'vitest';
import { createJevClient } from '../src/jev/client';
import { categories, decide } from '../src/jev/policy';

const response = (value = 0.8) => ({ model: 'jev-latest', answers: Object.fromEntries(categories.map(key => [key, { type: 'noul', noul: value }])), usage: { input_tokens: 123, output_tokens: 45 } });
it('全項目を1callのnoulで評価しIDなしstateとBearerを送り0.8を含めpolicyで判定する', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(response())));
  const state = { target: { text: 'お前は役立たずだ', publishedAt: '2026-01-01T00:00:00Z' }, history: [] };
  const result = await createJevClient(fetcher).evaluate(state, 'synthetic-jev', new AbortController().signal);
  expect(result).toMatchObject({ ok: true, value: { model: 'jev-latest', usage: { input_tokens: 123, output_tokens: 45 } } });
  if (!result.ok) throw new Error('expected evaluation');
  expect(decide(result.value.values)).toEqual({ malicious: true, reasons: [...categories] });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe('https://api.typesafe.ai/v1/systemone');
  expect(init).toMatchObject({ method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer synthetic-jev' } });
  const body = JSON.parse(init.body);
  expect(body.state).toEqual(state);
  expect(body.model).toBe('jev-latest');
  expect(Object.keys(body.questions)).toEqual([...categories]);
  for (const question of Object.values(body.questions) as { type: string; instructions: string }[]) {
    expect(question.type).toBe('noul');
    expect(question.instructions).toContain('未信頼');
  }
});
export { response };
it('providerの追加フィールドは結果へ透過せずusageは契約の2整数だけ', async () => {
  const body = { ...response(), usage: { ...response().usage, private: 'synthetic-secret' }, private: 'synthetic-secret' };
  const result = await createJevClient(vi.fn().mockResolvedValue(new Response(JSON.stringify(body)))).evaluate({ target: { text: '批判' }, history: [] }, 'synthetic', new AbortController().signal);
  expect(result).toMatchObject({ ok: true });
  expect(JSON.stringify(result)).not.toMatch(/synthetic|private/);
});
it('missingキー/network/壊れたJSON/Abortは固定失敗で評価を返さない', async () => {
  const state = { target: { text: 'こんにちは' }, history: [] };
  const fetcher = vi.fn().mockRejectedValue(new Error('synthetic-secret'));
  const client = createJevClient(fetcher);
  expect(await client.evaluate(state, '', new AbortController().signal)).toEqual({ ok: false, error: { code: 'missingKey' } });
  expect(fetcher).not.toHaveBeenCalled();
  expect(await client.evaluate(state, 'synthetic', new AbortController().signal)).toEqual({ ok: false, error: { code: 'network' } });
  fetcher.mockResolvedValue(new Response('not json'));
  expect(await client.evaluate(state, 'synthetic', new AbortController().signal)).toEqual({ ok: false, error: { code: 'invalidResponse' } });
  const controller = new AbortController(); controller.abort();
  expect(await client.evaluate(state, 'synthetic', controller.signal)).toEqual({ ok: false, error: { code: 'aborted' } });
});
it('20秒timeoutをnetworkへ変換し外部エラーを漏らさない', async () => {
  vi.useFakeTimers();
  try {
    const fetcher = vi.fn().mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('synthetic-secret')))));
    const pending = createJevClient(fetcher).evaluate({ target: { text: 'test' }, history: [] }, 'synthetic', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(20000);
    expect(await pending).toEqual({ ok: false, error: { code: 'network' } });
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it.each([
  { ...response(), model: '' }, { ...response(), usage: undefined },
  { ...response(), usage: { input_tokens: -1, output_tokens: 1 } },
  { ...response(), usage: { input_tokens: 1, output_tokens: 1.5 } },
  ...[undefined, { type: 'score', noul: 0.9 }, { type: 'noul', confidence: 0.9 }, { type: 'noul', noul: -0.1 }, { type: 'noul', noul: 1.1 }, { type: 'noul', noul: '0.8' }].map(answer => ({ ...response(), answers: { ...response().answers, attack: answer } })),
  { ...response(), answers: { ...response().answers, unexpected: { type: 'noul', noul: 0 } } },
])('全項目/型/model/usageの不正応答をrejectする: %j', async body => {
  expect(await createJevClient(vi.fn().mockResolvedValue(new Response(JSON.stringify(body)))).evaluate({ target: { text: 'test' }, history: [] }, 'synthetic', new AbortController().signal))
    .toEqual({ ok: false, error: { code: 'invalidResponse' } });
});
it.each([[401, 'auth'], [422, 'validation'], [429, 'rateLimited'], [529, 'overloaded']])('HTTP %iを固定%sへ変換し自動retryしない', async (status, code) => {
  const fetcher = vi.fn().mockResolvedValue(new Response('private-provider-body synthetic-jev', { status, headers: { 'Retry-After': '12' } }));
  const result = await createJevClient(fetcher).evaluate({ target: { text: '引用報告' }, history: [] }, 'synthetic-jev', new AbortController().signal);
  expect(result).toMatchObject({ ok: false, error: { code } });
  if (status === 429 || status === 529) expect(result).toMatchObject({ error: { retryAfterMillis: 12000 } });
  expect(JSON.stringify(result)).not.toMatch(/private|synthetic/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
