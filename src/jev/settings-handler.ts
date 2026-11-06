import type { MessageSender } from '../extension-runtime';
import type { createFilterSettings } from './settings';
import { validThreshold } from './threshold';
import { FilterSettingsFailure } from './settings-failure';
import { validFilterConfig } from './filter-config';
export function createFilterSettingsHandler({ settings, runtime }: {
  settings: Pick<ReturnType<typeof createFilterSettings>, 'read' | 'save'> & Partial<Pick<ReturnType<typeof createFilterSettings>, 'readConfig' | 'saveConfig' | 'resetInvalid'>>; runtime: { id: string; getURL(path: string): string };
}) {
  return { async handle(message: unknown, sender: MessageSender) {
    const denied = { ok: false as const, error: 'この要求は許可されていません。', code: 'authorization' as const };
    if (sender.id !== runtime.id || typeof message !== 'object' || message === null || Array.isArray(message)) return denied;
    const input = message as Record<string, unknown>;
    const options = sender.url === runtime.getURL('options.html');
    const reader = options || sender.url === runtime.getURL('popup.html') || sender.url === runtime.getURL('monitor.html');
    if (!reader || !['settings.getFilter', 'settings.saveFilter', 'settings.getFilterConfig', 'settings.saveFilterConfig', 'settings.resetInvalidFilter'].includes(String(input.type))) return denied;
    const getting = input.type === 'settings.getFilter' || input.type === 'settings.getFilterConfig';
    const resetting = input.type === 'settings.resetInvalidFilter';
    if (getting ? Object.keys(input).length !== 1 : !options || Object.keys(input).length !== (resetting ? 1 : input.type === 'settings.saveFilterConfig' ? 3 : 2)) return denied;
    if (input.type === 'settings.saveFilterConfig' && (!validFilterConfig(input.config) || !validFilterConfig(input.expected))) {
      return { ok: false as const, error: '判定の基準値は0以上1以下の数値で指定してください。', code: 'invalidInput' as const };
    }
    if (input.type === 'settings.saveFilter' && !validThreshold(input.threshold)) {
      return { ok: false as const, error: '判定の基準値は0以上1以下の数値で指定してください。', code: 'invalidInput' as const };
    }
    try {
      if (resetting) return { ok: true as const, value: { config: await settings.resetInvalid!() } };
      if (input.type === 'settings.getFilterConfig') return { ok: true as const, value: { config: await settings.readConfig!() } };
      if (input.type === 'settings.saveFilterConfig') return { ok: true as const, value: { config: await settings.saveConfig!(input.config, input.expected) } };
      const threshold = input.type === 'settings.getFilter' ? await settings.read() : await settings.save(input.threshold);
      // The legacy scalar contract cannot faithfully represent individual settings.
      if (!validThreshold(threshold)) throw new FilterSettingsFailure('unavailable');
      return { ok: true as const, value: { threshold } };
    } catch (error) { return { ok: false as const, error: 'フィルター設定の処理に失敗しました。再試行してください。', code: error instanceof FilterSettingsFailure ? error.code : 'unavailable' as const }; }
  } };
}
