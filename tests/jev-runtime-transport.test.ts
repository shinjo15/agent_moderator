import { expect, it, vi } from 'vitest';
import { createModerationTransport } from '../src/jev/runtime-transport';
import { categories } from '../src/jev/policy';
const values = Object.fromEntries(categories.map(key => [key, 0.1]));
const evaluated = { id: 'one', authorChannelId: 'author', burst: 'notObserved', malicious: false, reasons: [], jev: 'evaluated',
  evaluation: { values, model: 'jev-fixture', usage: { input_tokens: 1, output_tokens: 2 } } };
it('IPCはIDだけを送り正しい対応先の結果を受け取る', async () => {
  const sendMessage = vi.fn(async () => ({ ok: true, value: evaluated }));
  const transport = createModerationTransport({ sendMessage });
  expect(await transport.evaluate('one', 'author')).toEqual(evaluated);
  expect(sendMessage).toHaveBeenCalledWith({ type: 'jev.evaluate', id: 'one' });
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
