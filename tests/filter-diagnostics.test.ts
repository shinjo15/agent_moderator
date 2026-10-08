import { expect, it, vi } from 'vitest';
import { createFilterSettings } from '../src/jev/settings';
import { createFilterSettingsHandler } from '../src/jev/settings-handler';
const runtime = { id: 'synthetic-extension', getURL: (path: string) => `chrome-extension://synthetic-extension/${path}` };
const sender = { id: runtime.id, url: runtime.getURL('options.html') };
function setup() {
  const data: Record<string, unknown> = { 'moderation.threshold': 0.8 };
  const storage = { get: vi.fn(async () => ({ ...data })), set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); }) };
  const initialize = vi.fn(async () => {});
  const handler = createFilterSettingsHandler({ runtime, settings: createFilterSettings({ storage, initialize }) });
  return { data, storage, initialize, handler };
}
for (const fault of ['initialize', 'read', 'write', 'readback', 'missingReadback', 'invalidStored', 'invalidInput', 'authorization'] as const) {
  it(`設定の${fault}は固定codeだけを追加しprivate例外を返さない`, async () => {
    const { data, storage, initialize, handler } = setup();
    const message = ['read', 'invalidStored'].includes(fault) ? { type: 'settings.getFilter' }
      : { type: 'settings.saveFilter', threshold: fault === 'invalidInput' ? 'synthetic-private' : 0.8 };
    if (fault === 'initialize') initialize.mockRejectedValueOnce(new Error('synthetic-private'));
    if (fault === 'read' || fault === 'readback') storage.get.mockRejectedValueOnce(new Error('synthetic-private'));
    if (fault === 'write') storage.set.mockRejectedValueOnce(new Error('synthetic-private'));
    if (fault === 'missingReadback') storage.get.mockResolvedValueOnce({});
    if (fault === 'invalidStored') data['moderation.threshold'] = 'synthetic-private';
    const response = await handler.handle(message, fault === 'authorization' ? { ...sender, url: sender.url + '?forged=1' } : sender);
    expect(response).toMatchObject({ ok: false, code: fault === 'missingReadback' ? 'readback' : fault });
    expect(JSON.stringify(response)).not.toContain('synthetic-private');
    if (fault === 'initialize' || fault === 'authorization' || fault === 'invalidInput') {
      expect(storage.get).not.toHaveBeenCalled(); expect(storage.set).not.toHaveBeenCalled();
    }
  });
}
it('成功契約はpublic数値だけのままでfailure codeを混ぜない', async () => {
  const { handler } = setup();
  expect(await handler.handle({ type: 'settings.saveFilter', threshold: 0.8 }, sender)).toEqual({ ok: true, value: { threshold: 0.8 } });
});
it('未分類の待機/処理失敗はunavailableに固定し例外のmessage/codeを返さない', async () => {
  const handler = createFilterSettingsHandler({ runtime, settings: {
    read: async () => { throw new Error('synthetic-private'); },
    save: async () => { throw { message: 'synthetic-private', code: 'synthetic-private' }; },
  } });
  for (const message of [{ type: 'settings.getFilter' }, { type: 'settings.saveFilter', threshold: 0.8 }]) {
    const response = await handler.handle(message, sender);
    expect(response).toMatchObject({ ok: false, code: 'unavailable' });
    expect(JSON.stringify(response)).not.toContain('synthetic-private');
  }
});
