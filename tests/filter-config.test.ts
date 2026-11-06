import { expect, it, vi } from 'vitest';
import { createFilterSettings } from '../src/jev/settings';
import { categories, type Values } from '../src/jev/policy';
import { createFilterSettingsHandler } from '../src/jev/settings-handler';

const individual = Object.fromEntries(categories.map((key, i) => [key, i / 10])) as Values;
const custom = { mode: 'individual' as const, bulk: 0.73, individual };
function setup(initial: unknown = 0.731) {
  const data: Record<string, unknown> = { 'moderation.threshold': initial };
  const storage = { get: vi.fn(async () => structuredClone(data)), set: vi.fn(async (value: Record<string, unknown>) => { Object.assign(data, structuredClone(value)); }) };
  return { data, storage, settings: createFilterSettings({ storage, initialize: async () => {} }) };
}
async function save(settings: ReturnType<typeof createFilterSettings>, config: unknown) {
  return settings.saveConfig(config, await settings.readConfig());
}
it('旧scalarを判定値を変えずに読み、個別customをプリセット保存後も復帰できる', async () => {
  const { settings } = setup();
  expect(await settings.read()).toBe(0.731);
  expect(await settings.readConfig()).toEqual({ active: 'custom', custom: { mode: 'bulk', bulk: 0.731, individual: Object.fromEntries(categories.map(key => [key, 0.731])) } });
  await save(settings, { active: 'custom', custom });
  expect(await settings.read()).toEqual(individual);
  await save(settings, { active: 'high', custom });
  expect(await settings.read()).toBe(0.65);
  expect(await settings.readConfig()).toEqual({ active: 'high', custom: { ...custom, bulk: 0.731 } });
  await save(settings, { active: 'custom', custom });
  expect(await settings.read()).toEqual(individual);
});
it('不正な項目・値とreadback不一致は成功しない', async () => {
  const { settings, storage } = setup(0.8);
  await expect(save(settings, { active: 'custom', custom: { ...custom, individual: { ...individual, attack: 1.1 } } })).rejects.toMatchObject({ code: 'invalidInput' });
  storage.set.mockImplementationOnce(async () => {});
  await expect(save(settings, { active: 'custom', custom })).rejects.toMatchObject({ code: 'readback' });
});
it('設定IPCは信頼できるoptionsだけが個別設定を書き込み、読み戻せる', async () => {
  const { settings } = setup(0.8);
  const runtime = { id: 'fixture', getURL: (path: string) => `chrome-extension://fixture/${path}` };
  const handler = createFilterSettingsHandler({ settings, runtime });
  const sender = { id: runtime.id, url: runtime.getURL('options.html') };
  const config = { active: 'custom', custom };
  const expected = await settings.readConfig();
  expect(await handler.handle({ type: 'settings.saveFilterConfig', config, expected }, { ...sender, url: runtime.getURL('monitor.html') })).toMatchObject({ ok: false });
  expect(await handler.handle({ type: 'settings.saveFilterConfig', config, expected }, sender)).toEqual({ ok: true, value: { config } });
  expect(await handler.handle({ type: 'settings.getFilterConfig' }, sender)).toEqual({ ok: true, value: { config } });
  expect(await handler.handle({ type: 'settings.getFilter' }, sender)).toMatchObject({ ok: false });
});
it('偽装されたactiveは書き込まず、旧画面からのblind scalar保存を拒否する', async () => {
  const { settings, storage } = setup(0.8);
  await expect(save(settings, { active: ['custom'], custom: null })).rejects.toMatchObject({ code: 'invalidInput' });
  expect(storage.set).not.toHaveBeenCalled();
  await save(settings, { active: 'custom', custom });
  await expect(settings.save(0.65)).rejects.toMatchObject({ code: 'unavailable' });
  expect(await settings.readConfig()).toEqual({ active: 'custom', custom });
});
it('古い画面からのプリセット保存で別画面の保存済みcustomを消さない', async () => {
  const { settings } = setup(0.8);
  const old = await settings.readConfig();
  await save(settings, { active: 'custom', custom });
  await expect(settings.saveConfig({ ...old, active: 'high' }, old)).rejects.toMatchObject({ code: 'conflict' });
  expect(await settings.readConfig()).toEqual({ active: 'custom', custom });
});
it('破損値だけを明示復旧し、書込・読戻しに失敗したら成功としない', async () => {
  const { settings, storage, data } = setup({ active: 'custom', custom: { ...custom, individual: { attack: 0.2 } } });
  await expect(settings.readConfig()).rejects.toMatchObject({ code: 'invalidStored' });
  storage.set.mockRejectedValueOnce(new Error('fixture'));
  await expect(settings.resetInvalid()).rejects.toMatchObject({ code: 'write' });
  expect(data['moderation.threshold']).toMatchObject({ active: 'custom' });
  expect(await settings.resetInvalid()).toEqual({ active: 'medium', custom: null });
  expect(await settings.read()).toBe(0.8);
  await expect(settings.resetInvalid()).rejects.toMatchObject({ code: 'invalidInput' });
});
it('同じ保存版を開いた2画面が別項目を編集すると古い保存は競合として拒否する', async () => {
  const { settings } = setup(0.8);
  await save(settings, { active: 'custom', custom });
  const base = await settings.readConfig();
  const b = { active: 'custom', custom: { ...custom, individual: { ...individual, hate: 0.9 } } };
  await settings.saveConfig(b, base);
  const a = { active: 'custom', custom: { ...custom, individual: { ...individual, attack: 0.5 } } };
  await expect(settings.saveConfig(a, base)).rejects.toMatchObject({ code: 'conflict' });
  expect(await settings.read()).toEqual(b.custom.individual);
});
it('破損復旧の読戻し失敗は成功にせず、その後の読取で実状態を確認できる', async () => {
  const { settings, storage } = setup({ bad: true });
  storage.get.mockResolvedValueOnce({ 'moderation.threshold': { bad: true } }).mockRejectedValueOnce(new Error('fixture'));
  await expect(settings.resetInvalid()).rejects.toMatchObject({ code: 'readback' });
  expect(await settings.readConfig()).toEqual({ active: 'medium', custom: null });
});
it('破損復旧IPCはoptions以外から拒否し正常値は上書きしない', async () => {
  const { settings } = setup({ bad: true });
  const runtime = { id: 'fixture', getURL: (path: string) => `chrome-extension://fixture/${path}` };
  const handler = createFilterSettingsHandler({ settings, runtime });
  const options = { id: runtime.id, url: runtime.getURL('options.html') };
  expect(await handler.handle({ type: 'settings.resetInvalidFilter' }, { ...options, url: runtime.getURL('monitor.html') })).toMatchObject({ ok: false, code: 'authorization' });
  expect(await handler.handle({ type: 'settings.resetInvalidFilter' }, options)).toMatchObject({ ok: true });
  expect(await handler.handle({ type: 'settings.resetInvalidFilter' }, options)).toMatchObject({ ok: false, code: 'invalidInput' });
});
