import type { MessageSender } from './extension-runtime';
import { createBoundedQueue } from './retention';

// Bump when the explained usage/data conditions change; old confirmations never migrate automatically.
export const CONFIRMATION_VERSION = 2;
export const CONFIRMATION_KEY = 'usage.confirmation';
export const confirmationRequired = '設定で利用規約案・プライバシーポリシー案とデータの扱いに同意してください。同意できるまで外部送信しません。';
type Storage = { get(keys: string[]): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void> };
export function createConfirmation({ storage, initialize }: { storage: Storage; initialize(): Promise<void> }) {
  const exclusive = createBoundedQueue();
  let blocked = false;
  async function read() {
    try {
      await initialize();
      const value = (await storage.get([CONFIRMATION_KEY]))[CONFIRMATION_KEY];
      return !blocked && typeof value === 'object' && value !== null && !Array.isArray(value)
        && Object.keys(value).length === 1 && 'version' in value && value.version === CONFIRMATION_VERSION;
    } catch { return false; }
  }
  return {
    read,
    async handle(message: unknown, sender: MessageSender, runtime: { id: string; getURL(path: string): string }) {
      const denied = { ok: false as const, error: 'この要求は許可されていません。' };
      if (sender.id !== runtime.id || typeof message !== 'object' || message === null || Array.isArray(message)) return denied;
      const input = message as Record<string, unknown>;
      const options = sender.url === runtime.getURL('options.html');
      const reader = options || sender.url === runtime.getURL('popup.html') || sender.url === runtime.getURL('monitor.html');
      if (!reader) return denied;
      const status = (confirmed: boolean) => ({ ok: true as const, value: { confirmed, version: CONFIRMATION_VERSION } });
      if (input.type === 'confirmation.get' && Object.keys(input).length === 1) return status(await read());
      if (!options || input.type !== 'confirmation.confirm' || Object.keys(input).length !== 2 || input.version !== CONFIRMATION_VERSION) return denied;
      return exclusive(async () => {
        blocked = true;
        let writeAttempted = false;
        try {
          await initialize();
          writeAttempted = true;
          // Prepare a non-authorizing value; failed readback cannot leave an approval behind.
          await storage.set({ [CONFIRMATION_KEY]: { version: -1 } });
          const value = (await storage.get([CONFIRMATION_KEY]))[CONFIRMATION_KEY];
          if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 1
            || !('version' in value) || value.version !== -1) throw new Error('Confirmation readback');
          // The acknowledged final write is the commit point. No fallible read follows it.
          await storage.set({ [CONFIRMATION_KEY]: { version: CONFIRMATION_VERSION } });
          blocked = false;
          return status(true);
        } catch {
          // Best effort for an ambiguous rejected final write; this is not a durable
          // guarantee if storage applies that write but rejects both it and rollback.
          if (writeAttempted) try { await storage.set({ [CONFIRMATION_KEY]: { version: 0 } }); } catch { /* Remain blocked. */ }
          return { ok: false as const, error: '同意を保存できませんでした。もう一度同意してください。' };
        }
      }).catch(() => ({ ok: false as const, error: '同意を保存できませんでした。もう一度同意してください。' }));
    },
  };
}
