import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { t, initializePage } from '../src/i18n';
import { categories } from '../src/jev/policy';
import { errorMessages } from '../src/youtube/contracts';

it('Chrome標準カタログのen既定とja、およびplaceholderを揃える', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
  expect(manifest.default_locale).toBe('en');
  const catalogs = ['en', 'ja'].map(locale => JSON.parse(readFileSync(`public/_locales/${locale}/messages.json`, 'utf8')));
  expect(Object.keys(catalogs[0]).sort()).toEqual(Object.keys(catalogs[1]).sort());
  for (const key of Object.keys(catalogs[0])) {
    expect(catalogs[0][key].message).not.toBe('');
    expect(catalogs[1][key].message).not.toBe('');
    expect(catalogs[0][key].message.match(/\$\d/g) ?? []).toEqual(catalogs[1][key].message.match(/\$\d/g) ?? []);
    expect(catalogs[0][key].placeholders ?? {}).toEqual(catalogs[1][key].placeholders ?? {});
  }
});

it.each(['ja', 'ja-JP', 'en-US', 'fr', 'de'])('明示Chrome UI言語%sを利用し、未対応言語は標準enカタログを使用する', locale => {
  const selected = locale.startsWith('ja') ? 'ja' : 'en';
  const catalog = JSON.parse(readFileSync(`public/_locales/${selected}/messages.json`, 'utf8'));
  const getMessage = vi.fn((key: string, substitutions: string[] = []) => {
    const entry = catalog[key];
    if (!entry) return '';
    const named = entry.message.replace(/\$([a-z]+)\$/gi, (_: string, name: string) => entry.placeholders[name].content);
    return named.replace(/\$(\d)/g, (_: string, index: string) => substitutions[Number(index) - 1] ?? '');
  });
  vi.stubGlobal('chrome', { i18n: { getUILanguage: () => locale, getMessage } });
  vi.stubGlobal('document', { documentElement: { lang: '' }, title: '' });
  try {
    initializePage('settingsTitle');
    expect(document.documentElement.lang).toBe(selected);
    expect(document.title).toBe(selected === 'ja' ? 'Agent Moderator 設定' : 'Agent Moderator settings');
    expect(t('apiKey', 'Jev')).toBe(selected === 'ja' ? 'Jev APIキー' : 'Jev API key');
    expect(t('targetVideo', 'abcdefghijk')).toContain('abcdefghijk');
    expect(t('filterSelection', 'Medium', ' (same)')).toContain('Medium (same)');
    for (const key of categories) expect(t(`category_${key}`)).not.toBe('');
    for (const key of Object.keys(errorMessages)) expect(t(key === 'confirmationRequired' ? key : `youtube_${key}`)).not.toBe('');
    for (const code of ['missingKey', 'auth', 'validation', 'rateLimited', 'overloaded', 'network', 'invalidResponse', 'aborted', 'api']) expect(t(`jev_${code}`)).not.toBe('');
    expect(getMessage).toHaveBeenCalledWith('apiKey', ['Jev']);
  } finally { vi.unstubAllGlobals(); }
});

it('本番でChrome i18nが欠落しても日本語へ勝手にfallbackしない', () => {
  vi.stubGlobal('chrome', {});
  try { expect(() => t('openSettings')).toThrow(); }
  finally { vi.unstubAllGlobals(); }
});
