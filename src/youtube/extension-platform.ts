import type { ExtensionTabs, ExtensionWindows, SessionStorage } from './background-handler';

type Tab = { id?: number; url?: string };
export const platform = (globalThis as unknown as { chrome: {
  windows: ExtensionWindows;
  tabs: ExtensionTabs & {
    query(options: { active: boolean; currentWindow: boolean }): Promise<Tab[]>;
    onUpdated: { addListener(listener: (id: number, change: { url?: string; status?: string }, tab: Tab) => void): void };
    onRemoved: { addListener(listener: (id: number) => void): void };
  };
  storage: { local: SessionStorage; session: SessionStorage; onChanged: { addListener(listener: (changes: Record<string, unknown>, area: string) => void): void } };
} }).chrome;
