import { expect, it, vi } from 'vitest';
import { createFilterSettings } from '../src/jev/settings';
import { createFilterSettingsHandler } from '../src/jev/settings-handler';
import { FilterSettingsFailure, filterFailureReasons, publicThreshold } from '../src/jev/settings-failure';
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

// The UI uses this same parser. Classify each independent response branch once,
// rather than repeating the classification matrix for every UI request stage.
const marker = 'synthetic-private-key-storage-profile-error';
it('UI応答の欠落はnoResponseに固定する', () => {
  for (const response of [undefined, null]) {
    expect(() => publicThreshold(response)).toThrowError(expect.objectContaining({ code: 'noResponse' }));
  }
});
it('UIは既知の失敗codeのみ通し、providerのerror/private値を伝播しない', () => {
  for (const code of filterFailureReasons) {
    try { publicThreshold({ ok: false, code, error: marker, private: marker }); expect.unreachable(); }
    catch (error) {
      expect(error).toBeInstanceOf(FilterSettingsFailure);
      expect(error).toMatchObject({ code, shape: undefined });
      expect(String(error)).not.toContain(marker);
    }
  }
});
it.each([
  [{ ok: false, error: 'この要求は許可されていません。' }, 'responseDeniedLegacy'],
  [{ ok: false, error: marker }, 'unknownFailureCode'],
  [{ ok: false, code: marker, error: 'この要求は許可されていません。' }, 'unknownFailureCode'],
] as const)('UI拒否応答 %j を %s に分類し任意のcode/errorを公開しない', (response, code) => {
  expect(() => publicThreshold(response)).toThrowError(expect.objectContaining({ code,
    shape: { object: true, okTrue: false, okFalse: true, valueObject: false, thresholdNumber: false, thresholdValid: false },
  }));
});
it.each([
  [false, [false, false, false, false, false, false]],
  [[], [false, false, false, false, false, false]],
  [{ value: { threshold: 0.8 } }, [true, false, false, true, true, true]],
  [{ ok: true }, [true, true, false, false, false, false]],
  [{ ok: true, value: [] }, [true, true, false, false, false, false]],
  [{ ok: true, value: { threshold: '0.8' }, private: marker }, [true, true, false, true, false, false]],
  [{ ok: true, value: { threshold: 1.1 } }, [true, true, false, true, true, false]],
] as const)('UI不正応答 %j は値を含まないshapeだけを返す', (response, flags) => {
  try { publicThreshold(response); expect.unreachable(); }
  catch (error) {
    expect(error).toBeInstanceOf(FilterSettingsFailure);
    expect(error).toMatchObject({ code: 'invalidShape', shape: Object.fromEntries(
      ['object', 'okTrue', 'okFalse', 'valueObject', 'thresholdNumber', 'thresholdValid'].map((key, index) => [key, flags[index]])),
    });
    expect(JSON.stringify(error)).not.toContain(marker);
  }
});
it('UIは有効な数値だけを返し追加payloadを表示用の値に混ぜない', () => {
  for (const threshold of [0, 0.8, 1]) {
    expect(publicThreshold({ ok: true, value: { threshold }, private: marker })).toBe(threshold);
  }
});
