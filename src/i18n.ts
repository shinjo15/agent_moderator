// Chrome 120-compatible APIs. Chrome resolves unsupported languages through default_locale=en.
type ChromeI18n = { getMessage(key: string, substitutions?: string[]): string; getUILanguage(): string };
const i18n = () => (globalThis as unknown as { chrome: { i18n: ChromeI18n } }).chrome.i18n;
export function t(key: string, ...substitutions: (string | number)[]): string {
  return i18n().getMessage(key, substitutions.map(String));
}
export function initializePage(titleKey: string) {
  document.documentElement.lang = /^ja(?:-|$)/i.test(i18n().getUILanguage()) ? 'ja' : 'en';
  document.title = t(titleKey);
}
