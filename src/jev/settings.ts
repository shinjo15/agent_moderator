import { createBoundedQueue } from '../retention';
import { DEFAULT_THRESHOLD, validThreshold } from './threshold';
import { FilterSettingsFailure } from './settings-failure';
export const FILTER_THRESHOLD_KEY = 'moderation.threshold';
type Storage = { get(keys: string[]): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void> };
export function createFilterSettings({ storage, initialize }: { storage: Storage; initialize(): Promise<void> }) {
  const exclusive = createBoundedQueue();
  async function ready() {
    try { await initialize(); } catch { throw new FilterSettingsFailure('initialize'); }
  }
  async function read() {
    await ready();
    let stored: unknown;
    try { stored = (await storage.get([FILTER_THRESHOLD_KEY]))[FILTER_THRESHOLD_KEY]; }
    catch { throw new FilterSettingsFailure('read'); }
    if (stored === undefined) return DEFAULT_THRESHOLD;
    if (!validThreshold(stored)) throw new FilterSettingsFailure('invalidStored');
    return stored;
  }
  return {
    read: () => exclusive(read),
    save(threshold: unknown) {
      return exclusive(async () => {
        if (!validThreshold(threshold)) throw new FilterSettingsFailure('invalidInput');
        await ready();
        try { await storage.set({ [FILTER_THRESHOLD_KEY]: threshold }); }
        catch { throw new FilterSettingsFailure('write'); }
        // Read the exact raw target: missing data must not look like a successful default save.
        let stored: unknown;
        try { stored = (await storage.get([FILTER_THRESHOLD_KEY]))[FILTER_THRESHOLD_KEY]; }
        catch { throw new FilterSettingsFailure('readback'); }
        if (!validThreshold(stored) || stored !== threshold) throw new FilterSettingsFailure('readback');
        return stored;
      });
    },
  };
}
