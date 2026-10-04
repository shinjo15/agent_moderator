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
  for (const key of Object.keys(data)) delete data[key];
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

it('trusted初期化失敗時は固定エラーのみ返しread/write/deleteしない', async () => {
  local.setAccessLevel.mockRejectedValueOnce(new Error('synthetic-private-error'));
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
