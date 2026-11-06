import { createBoundedQueue } from '../retention';
import { DEFAULT_THRESHOLD, validThreshold } from './threshold';
import { FilterSettingsFailure } from './settings-failure';
import { configFromScalar, effectiveThreshold, mergeFilterConfig, sameFilterConfig, validFilterConfig } from './filter-config';
export const FILTER_THRESHOLD_KEY = 'moderation.threshold';
type Storage = { get(keys: string[]): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void> };
export function createFilterSettings({ storage, initialize }: { storage: Storage; initialize(): Promise<void> }) {
  const exclusive = createBoundedQueue();
  async function ready() {
    try { await initialize(); } catch { throw new FilterSettingsFailure('initialize'); }
  }
  async function readStored() {
    await ready();
    let stored: unknown;
    try { stored = (await storage.get([FILTER_THRESHOLD_KEY]))[FILTER_THRESHOLD_KEY]; }
    catch { throw new FilterSettingsFailure('read'); }
    if (stored === undefined) return DEFAULT_THRESHOLD;
    if (!validThreshold(stored) && !validFilterConfig(stored)) throw new FilterSettingsFailure('invalidStored');
    return stored;
  }
  return {
    resetInvalid: () => exclusive(async () => {
      await ready();
      let stored: unknown;
      try { stored = (await storage.get([FILTER_THRESHOLD_KEY]))[FILTER_THRESHOLD_KEY]; }
      catch { throw new FilterSettingsFailure('read'); }
      if (stored === undefined || validThreshold(stored) || validFilterConfig(stored)) throw new FilterSettingsFailure('invalidInput');
      try { await storage.set({ [FILTER_THRESHOLD_KEY]: DEFAULT_THRESHOLD }); }
      catch { throw new FilterSettingsFailure('write'); }
      try { stored = (await storage.get([FILTER_THRESHOLD_KEY]))[FILTER_THRESHOLD_KEY]; }
      catch { throw new FilterSettingsFailure('readback'); }
      if (stored !== DEFAULT_THRESHOLD) throw new FilterSettingsFailure('readback');
      return configFromScalar(DEFAULT_THRESHOLD);
    }),
    read: () => exclusive(async () => {
      const stored = await readStored();
      return typeof stored === 'number' ? stored : effectiveThreshold(stored);
    }),
    readConfig: () => exclusive(async () => {
      const stored = await readStored();
      return typeof stored === 'number' ? configFromScalar(stored) : stored;
    }),
    saveConfig(config: unknown, expected: unknown) {
      return exclusive(async () => {
        if (!validFilterConfig(config) || !validFilterConfig(expected)) throw new FilterSettingsFailure('invalidInput');
        const request = structuredClone(config);
        const previous = await readStored();
        const existing = typeof previous === 'number' ? configFromScalar(previous) : previous;
        if (!sameFilterConfig(existing, expected)) throw new FilterSettingsFailure('conflict');
        const snapshot = mergeFilterConfig(existing, request);
        try { await storage.set({ [FILTER_THRESHOLD_KEY]: snapshot }); }
        catch { throw new FilterSettingsFailure('write'); }
        let stored: unknown;
        try { stored = (await storage.get([FILTER_THRESHOLD_KEY]))[FILTER_THRESHOLD_KEY]; }
        catch { throw new FilterSettingsFailure('readback'); }
        if (!validFilterConfig(stored) || !sameFilterConfig(stored, snapshot)) throw new FilterSettingsFailure('readback');
        return stored;
      });
    },
    save(threshold: unknown) {
      return exclusive(async () => {
        if (!validThreshold(threshold)) throw new FilterSettingsFailure('invalidInput');
        const previous = await readStored();
        // Old clients have no comparable snapshot of the new configuration.
        if (typeof previous !== 'number') throw new FilterSettingsFailure('unavailable');
        try { await storage.set({ [FILTER_THRESHOLD_KEY]: threshold }); }
        catch { throw new FilterSettingsFailure('write'); }
        // Read the exact raw target: missing data must not look like a successful default save.
        let stored: unknown;
        try { stored = (await storage.get([FILTER_THRESHOLD_KEY]))[FILTER_THRESHOLD_KEY]; }
        catch { throw new FilterSettingsFailure('readback'); }
        if (stored !== threshold) throw new FilterSettingsFailure('readback');
        return threshold;
      });
    },
  };
}
