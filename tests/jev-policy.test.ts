import { expect, it } from 'vitest';
import { categories, decide, questions, type Values } from '../src/jev/policy';
import { createJevClient } from '../src/jev/client';
import { apiResponse, japaneseExamples } from './fixtures/jev';
it.each(categories)('%sの0/0.799999/0.8/1境界でconfidenceでなくnoul評価値を閾値比較する', key => {
  for (const value of [0, 0.799999, 0.8, 1]) {
    const values = Object.fromEntries(categories.map(category => [category, category === key ? value : 0])) as Values;
    expect(decide(values)).toEqual({ malicious: value >= 0.8, reasons: value >= 0.8 ? [key] : [] });
  }
});
it.each(japaneseExamples)('日本語評価fixture: $text（実モデル測定ではない）', async example => {
  const fixture = apiResponse(example.category ? { [example.category]: 0.8 } : {});
  const state = { target: { text: example.text, publishedAt: '2026-01-01T00:00:01Z' },
    history: [{ text: '過去の攻撃「人間失格」', publishedAt: '2026-01-01T00:00:00Z' }] };
  let sent: unknown;
  const client = createJevClient(async (_url, init) => { sent = JSON.parse(init!.body as string); return new Response(JSON.stringify(fixture)); });
  const result = await client.evaluate(state, 'synthetic', new AbortController().signal);
  expect(sent).toMatchObject({ state, questions });
  if (!result.ok) throw new Error('invalid fixture');
  expect(decide(result.value.values)).toEqual({ malicious: example.category !== undefined, reasons: example.category ? [example.category] : [] });
});
it('固定rubricはtargetだけを評価しhistoryの過去攻撃を現在へ転嫁しない', () => {
  for (const question of Object.values(questions)) {
    expect(question.instructions).toContain('過去の攻撃だけ');
    expect(question.instructions).toContain('文脈不明');
    expect(question.instructions).toContain('ネタバレは対象外');
  }
});
