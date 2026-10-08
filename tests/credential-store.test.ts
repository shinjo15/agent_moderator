import { afterEach, expect, it, vi } from 'vitest';
import { createFilterSettings } from '../src/jev/settings';

const data: Record<string, unknown> = {};
const storage = {
  setAccessLevel: vi.fn(async (_options: { accessLevel: string }) => {}),
  get: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map(key => [key, data[key]]))),
  set: vi.fn(async (values: Record<string, unknown>) => { Object.assign(data, values); }),
  remove: vi.fn(async (keys: string[]) => { for (const key of keys) delete data[key]; }),
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
  storage.setAccessLevel.mockReset().mockResolvedValue(undefined);
  for (const key of Object.keys(data)) delete data[key];
});

it('毎起動のtrusted初期化成功前には読み書きを行わない', async () => {
  let release!: () => void;
  storage.setAccessLevel.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  vi.stubGlobal('chrome', { storage: { local: storage } });
  const store = await import('../src/credential-store');
  const ready = store.initializeCredentialStorage();
  const read = store.readYouTubeApiKeyForBackground();
  const write = store.saveApiKey('youtube', 'synthetic-youtube');
  await Promise.resolve();
  expect(storage.setAccessLevel).toHaveBeenCalledExactlyOnceWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  expect(storage.get).not.toHaveBeenCalled();
  expect(storage.set).not.toHaveBeenCalled();
  release();
  await Promise.all([ready, read, write]);
  expect(await store.readYouTubeApiKeyForBackground()).toBe('synthetic-youtube');
});

it('初期化が失敗すると全操作がfail closedとなり秘密を読み書きしない', async () => {
  storage.setAccessLevel.mockRejectedValue(new Error('synthetic-private-error'));
  vi.stubGlobal('chrome', { storage: { local: storage } });
  const store = await import('../src/credential-store');
  await expect(store.initializeCredentialStorage()).rejects.toThrow();
  await expect(store.readYouTubeApiKeyForBackground()).rejects.toThrow();
  await expect(store.saveApiKey('youtube', 'synthetic-value')).rejects.toThrow();
  await expect(store.deleteApiKey('youtube')).rejects.toThrow();
  expect(storage.get).not.toHaveBeenCalled();
  expect(storage.set).not.toHaveBeenCalled();
  expect(storage.remove).not.toHaveBeenCalled();
});

it('一時初期化失敗は次の明示操作で再初期化し、許可完了前はフィルターもキーも書かない', async () => {
  storage.setAccessLevel.mockRejectedValueOnce(new Error('synthetic-private-error'));
  vi.stubGlobal('chrome', { storage: { local: storage } });
  const store = await import('../src/credential-store');
  await expect(store.initializeCredentialStorage()).rejects.toThrow();
  let release!: () => void;
  storage.setAccessLevel.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
  const settings = createFilterSettings({ storage, initialize: store.initializeCredentialStorage });
  const outcomes = Promise.allSettled([settings.save(0.8), store.saveApiKey('jev', 'synthetic-retry')]);
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(storage.setAccessLevel).toHaveBeenCalledTimes(2);
  expect(storage.get).not.toHaveBeenCalled(); expect(storage.set).not.toHaveBeenCalled();
  release();
  expect((await outcomes).map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
  expect(await settings.read()).toBe(0.8);
  expect(await store.getCredentialStatus()).toEqual({ jev: true, youtube: false });
  expect(storage.setAccessLevel).toHaveBeenCalledTimes(2);
});

it('provider別に保存・空欄保持・差替え・削除しstatusはbooleanのみ返す', async () => {
  vi.stubGlobal('chrome', { storage: { local: storage } });
  const store = await import('../src/credential-store');
  expect(await store.getCredentialStatus()).toEqual({ jev: false, youtube: false });
  await store.saveApiKey('jev', 'synthetic-jev');
  await store.saveApiKey('youtube', 'synthetic-youtube');
  await store.saveApiKey('youtube', '');
  expect(await store.readYouTubeApiKeyForBackground()).toBe('synthetic-youtube');
  expect(await store.readJevApiKeyForBackground()).toBe('synthetic-jev');
  expect(await store.getCredentialStatus()).toEqual({ jev: true, youtube: true });
  await store.saveApiKey('youtube', 'synthetic-replacement');
  expect(await store.readYouTubeApiKeyForBackground()).toBe('synthetic-replacement');
  await store.deleteApiKey('youtube');
  expect(await store.readYouTubeApiKeyForBackground()).toBeUndefined();
  expect(await store.getCredentialStatus()).toEqual({ jev: true, youtube: false });
  await store.deleteApiKey('jev');
  expect(await store.readJevApiKeyForBackground()).toBeUndefined();
});
