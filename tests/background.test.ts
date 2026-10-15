import { afterEach, expect, it, vi } from 'vitest';
import { CONFIRMATION_VERSION } from '../src/confirmation';

it('説明の版2では旧版1の確認と保存要求を同意へ自動移行しない', async () => {
  await start();
  data['usage.confirmation'] = { version: 1 };
  expect(await send({ type: 'confirmation.get' })).toEqual({ ok: true, value: { confirmed: false, version: 2 } });
  expect(await send({ type: 'confirmation.confirm', version: 1 })).toMatchObject({ ok: false });
  expect(local.set).not.toHaveBeenCalled();
  expect(data['usage.confirmation']).toEqual({ version: 1 });
});

type Sender = { id?: string; url?: string; tab?: object };
type Listener = (message: unknown, sender: Sender, reply: (response: unknown) => void) => boolean;
const data: Record<string, unknown> = {};
const local = {
  setAccessLevel: vi.fn(async () => {}),
  get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map(key => [key, data[key]]))),
  set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); }),
  remove: vi.fn(async (keys: string[]) => { for (const key of keys) delete data[key]; }),
};
let listener: Listener;
let externalListener: Listener;
async function start() {
  vi.stubGlobal('chrome', { storage: { local }, runtime: {
    id: 'test-extension',
    getURL: (path: string) => `chrome-extension://test-extension/${path}`,
    onMessage: { addListener: (value: Listener) => { listener = value; } },
    onMessageExternal: { addListener: (value: Listener) => { externalListener = value; } },
  } });
  await import('../src/background');
}
const trusted = { id: 'test-extension', url: 'chrome-extension://test-extension/options.html', tab: {} };
function send(message: unknown, sender: Sender = trusted, external = false) {
  return new Promise<unknown>(resolve => (external ? externalListener : listener)(message, sender, resolve));
}
afterEach(() => {
  vi.resetModules(); vi.unstubAllGlobals(); vi.clearAllMocks();
  local.setAccessLevel.mockReset().mockResolvedValue(undefined);
  for (const key of Object.keys(data)) delete data[key];
});

it('利用条件確認はversionのみ保存し再起動後もpublic状態だけを返す', async () => {
  await start();
  expect(await send({ type: 'confirmation.get' })).toEqual({ ok: true, value: { confirmed: false, version: CONFIRMATION_VERSION } });
  expect(await send({ type: 'confirmation.confirm', version: CONFIRMATION_VERSION })).toEqual({ ok: true, value: { confirmed: true, version: CONFIRMATION_VERSION } });
  expect(data['usage.confirmation']).toEqual({ version: CONFIRMATION_VERSION });
  await send({ type: 'credentials.save', provider: 'youtube', value: 'synthetic-private' });
  await send({ type: 'credentials.delete', provider: 'youtube' });
  expect(await send({ type: 'confirmation.get' })).toEqual({ ok: true, value: { confirmed: true, version: CONFIRMATION_VERSION } });
  vi.resetModules(); await start();
  expect(await send({ type: 'confirmation.get' })).toEqual({ ok: true, value: { confirmed: true, version: CONFIRMATION_VERSION } });
});

it('利用条件確認の読取・保存・旧版payloadと権限をfail closedにする', async () => {
  await start();
  for (const value of [undefined, null, true, 1, '1', [], { version: 0 }, { version: 1 }, { version: '2' }, { version: CONFIRMATION_VERSION, key: 'synthetic-private' }]) {
    data['usage.confirmation'] = value;
    expect(await send({ type: 'confirmation.get' })).toEqual({ ok: true, value: { confirmed: false, version: CONFIRMATION_VERSION } });
  }
  local.get.mockRejectedValueOnce(new Error('synthetic-private'));
  expect(await send({ type: 'confirmation.get' })).toMatchObject({ ok: true, value: { confirmed: false } });
  for (const message of [{ type: 'confirmation.confirm', version: 0 }, { type: 'confirmation.confirm', version: '1' },
    { type: 'confirmation.confirm', version: CONFIRMATION_VERSION, extra: true }, { type: 'confirmation.get', extra: true }]) {
    expect(await send(message)).toMatchObject({ ok: false });
  }
  for (const sender of [{ id: 'other', url: trusted.url }, { ...trusted, url: `${trusted.url}?x` },
    { ...trusted, url: 'https://www.youtube.com/live_chat' }, { ...trusted, url: trusted.url.replace('options', 'popup') },
    { ...trusted, url: trusted.url.replace('options', 'monitor') }]) {
    expect(await send({ type: 'confirmation.confirm', version: CONFIRMATION_VERSION }, sender)).toMatchObject({ ok: false });
  }
  expect(await send({ type: 'confirmation.confirm', version: CONFIRMATION_VERSION }, trusted, true)).toMatchObject({ ok: false });
  expect(local.set).not.toHaveBeenCalled();
  local.set.mockRejectedValueOnce(new Error('synthetic-private'));
  expect(await send({ type: 'confirmation.confirm', version: CONFIRMATION_VERSION })).toMatchObject({ ok: false });
  expect(await send({ type: 'confirmation.get' })).toMatchObject({ ok: true, value: { confirmed: false } });
  local.set.mockResolvedValueOnce(undefined);
  expect(await send({ type: 'confirmation.confirm', version: CONFIRMATION_VERSION })).toMatchObject({ ok: false });
});

it('確認保存のreadback失敗は再起動しても未確認とし既存キー・閾値・非表示を消さない', async () => {
  await start();
  data['apiKey.youtube'] = 'synthetic-private'; data['moderation.threshold'] = 0.731;
  data['hiddenAuthors.abcdefghijk'] = { ids: ['UCabcdefghijklmnopqrstuv'], revisions: {} };
  local.get.mockRejectedValueOnce(new Error('synthetic-private'));
  expect(await send({ type: 'confirmation.confirm', version: CONFIRMATION_VERSION })).toMatchObject({ ok: false });
  vi.resetModules(); await start();
  expect(await send({ type: 'confirmation.get' })).toMatchObject({ ok: true, value: { confirmed: false } });
  expect(data['apiKey.youtube']).toBe('synthetic-private'); expect(data['moderation.threshold']).toBe(0.731);
  expect(data['hiddenAuthors.abcdefghijk']).toEqual({ ids: ['UCabcdefghijklmnopqrstuv'], revisions: {} });
});

it('確認保存のreadback拒否とrollback拒否が重なってもworker再作成で確認済みに戻らない', async () => {
  await start();
  local.set.mockImplementationOnce(async values => { Object.assign(data, values); })
    .mockRejectedValueOnce(new Error('rollback refused'));
  local.get.mockRejectedValueOnce(new Error('readback refused'));
  expect(await send({ type: 'confirmation.confirm', version: CONFIRMATION_VERSION })).toMatchObject({ ok: false });
  expect(await send({ type: 'confirmation.get' })).toMatchObject({ ok: true, value: { confirmed: false } });
  vi.resetModules(); await start();
  expect(await send({ type: 'confirmation.get' })).toMatchObject({ ok: true, value: { confirmed: false } });
  expect(await send({ type: 'confirmation.confirm', version: CONFIRMATION_VERSION })).toMatchObject({ ok: true, value: { confirmed: true } });
});

it('確定書込の成功応答後は追加readbackの故障を保存失敗として返さない', async () => {
  await start();
  local.set.mockImplementationOnce(async values => { Object.assign(data, values); })
    .mockImplementationOnce(async values => {
      Object.assign(data, values);
      local.get.mockRejectedValueOnce(new Error('post-commit read unavailable'));
    });
  expect(await send({ type: 'confirmation.confirm', version: CONFIRMATION_VERSION })).toMatchObject({ ok: true, value: { confirmed: true } });
  expect(await send({ type: 'confirmation.get' })).toMatchObject({ ok: true, value: { confirmed: false } });
  vi.resetModules(); await start();
  expect(await send({ type: 'confirmation.get' })).toMatchObject({ ok: true, value: { confirmed: true } });
});

it('保証限界: 最終書込が反映後に拒否しrollbackも拒否する故障は再作成後に区別できない', async () => {
  await start();
  local.set.mockImplementationOnce(async values => { Object.assign(data, values); })
    .mockImplementationOnce(async values => { Object.assign(data, values); throw new Error('ambiguous commit'); })
    .mockRejectedValueOnce(new Error('rollback unavailable'));
  expect(await send({ type: 'confirmation.confirm', version: CONFIRMATION_VERSION })).toMatchObject({ ok: false });
  expect(await send({ type: 'confirmation.get' })).toMatchObject({ ok: true, value: { confirmed: false } });
  expect(data['usage.confirmation']).toEqual({ version: CONFIRMATION_VERSION });
  vi.resetModules(); await start();
  // This is a documented fault-model limit, not a claimed durable fail-closed success.
  expect(await send({ type: 'confirmation.get' })).toMatchObject({ ok: true, value: { confirmed: true } });
});

it('フィルター設定はlegacy既定中でpublic値だけを返し保存・再起動readbackを維持する', async () => {
  await start();
  data['apiKey.jev'] = 'synthetic-private';
  expect(await send({ type: 'settings.getFilter' })).toEqual({ ok: true, value: { threshold: 0.8 } });
  for (const threshold of [0.65, 0.8, 0.9, 0, 1, 0.731]) {
    expect(await send({ type: 'settings.saveFilter', threshold })).toEqual({ ok: true, value: { threshold } });
    expect(await send({ type: 'settings.getFilter' })).toEqual({ ok: true, value: { threshold } });
  }
  expect(await send({ type: 'storage.init' })).toEqual({ ok: true, status: { jev: true, youtube: false } });
  vi.resetModules(); await start();
  expect(await send({ type: 'settings.getFilter' })).toEqual({ ok: true, value: { threshold: 0.731 } });
});
it('不正閾値・余分payload・content/external・options以外の書込は拒否する', async () => {
  await start();
  for (const threshold of ['', '0.8', undefined, null, NaN, Infinity, -Infinity, -0.1, 1.1]) {
    expect(await send({ type: 'settings.saveFilter', threshold })).toMatchObject({ ok: false });
  }
  expect(await send({ type: 'settings.saveFilter', threshold: 0.65, extra: true })).toMatchObject({ ok: false });
  expect(await send({ type: 'settings.getFilter', extra: true })).toMatchObject({ ok: false });
  for (const sender of [{ id: 'test-extension', url: 'https://www.youtube.com/live_chat' },
    { id: 'other', url: trusted.url }, { ...trusted, url: `${trusted.url}?fake=1` },
    { ...trusted, url: trusted.url.replace('options', 'monitor') }]) {
    expect(await send({ type: 'settings.saveFilter', threshold: 0.65 }, sender)).toMatchObject({ ok: false });
  }
  expect(await send({ type: 'settings.saveFilter', threshold: 0.65 }, trusted, true)).toMatchObject({ ok: false });
  expect(local.set).not.toHaveBeenCalled();
});
it('書込失敗・readback不一致・不正保存値を設定成功として扱わない', async () => {
  await start();
  local.set.mockRejectedValueOnce(new Error('synthetic-private'));
  expect(await send({ type: 'settings.saveFilter', threshold: 0.65 })).toMatchObject({ ok: false });
  local.set.mockResolvedValueOnce(undefined);
  expect(await send({ type: 'settings.saveFilter', threshold: 0.65 })).toMatchObject({ ok: false });
  data['moderation.threshold'] = '0.65';
  expect(await send({ type: 'settings.getFilter' })).toMatchObject({ ok: false });
  expect(await send({ type: 'settings.saveFilter', threshold: 0 })).toEqual({ ok: true, value: { threshold: 0 } });
});

it('backgroundは毎起動時初期化しtrusted storage.initへboolean statusだけ返す', async () => {
  await start();
  expect(local.setAccessLevel).toHaveBeenCalledExactlyOnceWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  expect(await send({ type: 'storage.init' })).toEqual({ ok: true, status: { jev: false, youtube: false } });
});

it('content sender・外部sender・偽装URLのinit/save/delete/getをstorage操作前に拒否する', async () => {
  await start();
  const senders = [
    { id: 'test-extension', url: 'https://www.youtube.com/live_chat', tab: {} },
    { id: 'other-extension', url: trusted.url },
    { id: 'test-extension', url: `${trusted.url}/evil` },
    { id: 'test-extension' },
  ];
  for (const sender of senders) {
    for (const type of ['storage.init', 'credentials.save', 'credentials.delete', 'credentials.get']) {
      expect(await send({ type, provider: 'youtube', value: 'synthetic-private' }, sender)).toEqual({ ok: false, error: 'この要求は許可されていません。' });
    }
  }
  expect(await send({ type: 'storage.init' }, trusted, true)).toEqual({ ok: false, error: 'この要求は許可されていません。' });
  expect(local.get).not.toHaveBeenCalled();
  expect(local.set).not.toHaveBeenCalled();
  expect(local.remove).not.toHaveBeenCalled();
});

it('trusted保存・削除の応答はstatusのみで生キー取得要求はtrustedでも拒否する', async () => {
  await start();
  expect(await send({ type: 'credentials.save', provider: 'youtube', value: 'synthetic-private' })).toEqual({ ok: true, status: { jev: false, youtube: true } });
  expect(await send({ type: 'credentials.get', provider: 'youtube' })).toEqual({ ok: false, error: 'この要求は許可されていません。' });
  expect(await send({ type: 'credentials.delete', provider: 'youtube' })).toEqual({ ok: true, status: { jev: false, youtube: false } });
});

it('不正なpayloadは拒否しキーを書き込まない', async () => {
  await start();
  for (const message of [null, 'synthetic-private', {},
    { type: 'credentials.save', provider: 'invalid', value: 'synthetic-private' },
    { type: 'credentials.save', provider: 'youtube', value: 123 },
    { type: 'credentials.delete', provider: 'invalid' }]) {
    expect(await send(message)).toEqual({ ok: false, error: 'この要求は許可されていません。' });
  }
  expect(local.set).not.toHaveBeenCalled();
  expect(local.remove).not.toHaveBeenCalled();
});

it('externalのsettings拒否だけauthorization codeを返しcredentials応答は変えない', async () => {
  await start();
  for (const type of ['settings.getFilter', 'settings.saveFilter']) {
    expect(await send({ type, threshold: 0.8 }, trusted, true)).toEqual({ ok: false, error: 'この要求は許可されていません。', code: 'authorization' });
  }
  expect(await send({ type: 'storage.init' }, trusted, true)).toEqual({ ok: false, error: 'この要求は許可されていません。' });
  expect(local.get).not.toHaveBeenCalled(); expect(local.set).not.toHaveBeenCalled();
});

it('trusted初期化失敗時は固定エラーのみ返しread/write/deleteしない', async () => {
  local.setAccessLevel.mockRejectedValue(new Error('synthetic-private-error'));
  await start();
  expect(await send({ type: 'confirmation.get' })).toMatchObject({ ok: true, value: { confirmed: false } });
  expect(await send({ type: 'confirmation.confirm', version: CONFIRMATION_VERSION })).toMatchObject({ ok: false });
  for (const message of [{ type: 'storage.init' },
    { type: 'credentials.save', provider: 'youtube', value: 'synthetic-private' },
    { type: 'credentials.delete', provider: 'youtube' }]) {
    expect(await send(message)).toEqual({ ok: false, error: 'キー設定の処理に失敗しました。再試行してください。' });
  }
  expect(local.get).not.toHaveBeenCalled();
  expect(local.set).not.toHaveBeenCalled();
  expect(local.remove).not.toHaveBeenCalled();
});
