import { afterEach, expect, it, vi } from 'vitest';

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
  for (const message of [{ type: 'storage.init' },
    { type: 'credentials.save', provider: 'youtube', value: 'synthetic-private' },
    { type: 'credentials.delete', provider: 'youtube' }]) {
    expect(await send(message)).toEqual({ ok: false, error: 'キー設定の処理に失敗しました。再試行してください。' });
  }
  expect(local.get).not.toHaveBeenCalled();
  expect(local.set).not.toHaveBeenCalled();
  expect(local.remove).not.toHaveBeenCalled();
});
