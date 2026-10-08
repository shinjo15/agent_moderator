import type { MessageSender } from '../extension-runtime';
import type { createFilterSettings } from './settings';
import { validThreshold } from './threshold';
import { FilterSettingsFailure } from './settings-failure';
export function createFilterSettingsHandler({ settings, runtime }: {
  settings: ReturnType<typeof createFilterSettings>; runtime: { id: string; getURL(path: string): string };
}) {
  return { async handle(message: unknown, sender: MessageSender) {
    const denied = { ok: false as const, error: 'この要求は許可されていません。', code: 'authorization' as const };
    if (sender.id !== runtime.id || typeof message !== 'object' || message === null || Array.isArray(message)) return denied;
    const input = message as Record<string, unknown>;
    const options = sender.url === runtime.getURL('options.html');
    const reader = options || sender.url === runtime.getURL('popup.html') || sender.url === runtime.getURL('monitor.html');
    if (!reader || (input.type !== 'settings.getFilter' && input.type !== 'settings.saveFilter')) return denied;
    if (input.type === 'settings.getFilter' ? Object.keys(input).length !== 1 : !options || Object.keys(input).length !== 2) return denied;
    if (input.type === 'settings.saveFilter' && !validThreshold(input.threshold)) {
      return { ok: false as const, error: '判定の基準値は0以上1以下の数値で指定してください。', code: 'invalidInput' as const };
    }
    try {
      const threshold = input.type === 'settings.getFilter' ? await settings.read() : await settings.save(input.threshold);
      return { ok: true as const, value: { threshold } };
    } catch (error) { return { ok: false as const, error: 'フィルター設定の処理に失敗しました。再試行してください。', code: error instanceof FilterSettingsFailure ? error.code : 'unavailable' as const }; }
  } };
}
