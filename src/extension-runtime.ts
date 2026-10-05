export interface MessageSender {
  id?: string;
  url?: string;
  tab?: unknown;
}
export type MessageListener = (message: unknown, sender: MessageSender, reply: (response: unknown) => void) => boolean;
interface ExtensionRuntime {
  id: string;
  getURL(path: string): string;
  sendMessage(message: unknown): Promise<unknown>;
  onMessage: { addListener(listener: MessageListener): void };
  onMessageExternal: { addListener(listener: MessageListener): void };
}
export const runtime = (globalThis as unknown as { chrome: { runtime: ExtensionRuntime } }).chrome.runtime;
