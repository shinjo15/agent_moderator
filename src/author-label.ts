import { validDisplayName } from './youtube/contracts';
import { t } from './i18n';
export const displayAuthorName = (value: unknown): string => validDisplayName(value) ? value : t('unknownName');
export function createAuthorLabel(authorChannelId: string, displayName?: string) {
  const label = document.createElement('div'); label.className = 'author-label';
  const name = document.createElement('span'); name.className = 'author-name'; name.textContent = displayAuthorName(displayName);
  const details = document.createElement('details'); details.className = 'author-details';
  const summary = document.createElement('summary'); summary.textContent = t('authorId');
  const id = document.createElement('span'); id.textContent = authorChannelId;
  details.append(summary, id); label.append(name, details);
  return label;
}
