import { expect, it, vi } from 'vitest';
import { createModerationTransport } from '../src/jev/runtime-transport';
import { categories, type Values } from '../src/jev/policy';
const values = Object.fromEntries(categories.map(key => [key, 0.1])) as Values;
const evaluated = { id: 'one', authorChannelId: 'author', burst: 'notObserved', malicious: false, reasons: [], jev: 'evaluated', threshold: 0.8,
  evaluation: { values, model: 'jev-fixture', usage: { input_tokens: 1, output_tokens: 2 } } };
it('IPCはIDだけを送り正しい対応先の結果を受け取る', async () => {
  const sendMessage = vi.fn(async () => ({ ok: true, value: evaluated }));
  const transport = createModerationTransport({ sendMessage });
  expect(await transport.evaluate('one', 'author')).toEqual(evaluated);
  expect(sendMessage).toHaveBeenCalledWith({ type: 'jev.evaluate', id: 'one' });
});
it.each([0, 0.65, 0.9, 1])('IPCは現在の固定値でなく評価snapshot閾値%sに従う', async threshold => {
  const scores = { ...values, attack: 0.7 };
  const reasons = categories.filter(key => scores[key] >= threshold);
  const value = { ...evaluated, threshold, malicious: reasons.length > 0, reasons, evaluation: { ...evaluated.evaluation, values: scores } };
  expect(await createModerationTransport({ sendMessage: async () => ({ ok: true, value }) }).evaluate('one', 'author')).toEqual(value);
});
it.each([undefined, '', '0.8', NaN, Infinity, -0.1, 1.1])('evaluated結果の閾値%sは不正で表示へ流さない', async threshold => {
  expect(await createModerationTransport({ sendMessage: async () => ({ ok: true, value: { ...evaluated, threshold } }) }).evaluate('one', 'author')).toBeUndefined();
});
it.each([
  { ...evaluated, id: 'other' }, { ...evaluated, authorChannelId: 'other' },
  { ...evaluated, malicious: true }, { ...evaluated, reasons: ['unknown'] },
  { ...evaluated, evaluation: { ...evaluated.evaluation, usage: { input_tokens: -1, output_tokens: 2 } } },
  { ...evaluated, jev: 'failed', malicious: true, reasons: ['attack'], error: { code: 'auth', message: 'synthetic-secret' } },
  { ...evaluated, evaluation: { ...evaluated.evaluation, values: { ...values, attack: NaN } } },
])('不正IPCの判定/対応付けを表示に流さない %j', async value => {
  expect(await createModerationTransport({ sendMessage: async () => ({ ok: true, value }) }).evaluate('one', 'author')).toBeUndefined();
});
it('IPCの例外/秘密入りエラーは固定codeのみ', async () => {
  const transport = createModerationTransport({ sendMessage: async () => { throw new Error('synthetic-secret'); } });
  expect(await transport.enable()).toEqual({ ok: false, error: { code: 'network' } });
  expect(await transport.evaluate('one', 'author')).toBeUndefined();
  await transport.stop();
  expect(await createModerationTransport({ sendMessage: async () => ({ ok: false, error: { code: 'auth', message: 'synthetic-secret' } }) }).enable())
    .toEqual({ ok: false, error: { code: 'auth' } });
});
