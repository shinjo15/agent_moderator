export type ApiKeyProvider = 'jev' | 'youtube';
export type CredentialStatus = Record<ApiKeyProvider, boolean>;

interface LocalStorage {
  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

const local = () => (globalThis as unknown as { chrome: { storage: { local: LocalStorage } } }).chrome.storage.local;
const storageKey = (provider: ApiKeyProvider) => `apiKey.${provider}`;
let initialization: Promise<void> | undefined;

// Called at every service-worker startup; every operation awaits this same gate.
export function initializeCredentialStorage(): Promise<void> {
  initialization ??= local().setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  return initialization;
}

async function readApiKey(provider: ApiKeyProvider): Promise<string | undefined> {
  await initializeCredentialStorage();
  const value = (await local().get([storageKey(provider)]))[storageKey(provider)];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// Background-only internal APIs. Never expose their results over runtime messages.
export function readYouTubeApiKeyForBackground(): Promise<string | undefined> {
  return readApiKey('youtube');
}

export function readJevApiKeyForBackground(): Promise<string | undefined> {
  return readApiKey('jev');
}

export async function getCredentialStatus(): Promise<CredentialStatus> {
  return { jev: Boolean(await readApiKey('jev')), youtube: Boolean(await readApiKey('youtube')) };
}

export async function saveApiKey(provider: ApiKeyProvider, value: string): Promise<void> {
  await initializeCredentialStorage();
  if (value === '') return;
  await local().set({ [storageKey(provider)]: value });
}

export async function deleteApiKey(provider: ApiKeyProvider): Promise<void> {
  await initializeCredentialStorage();
  await local().remove([storageKey(provider)]);
}
