import { validDisplayName } from './youtube/contracts';
export const displayAuthorName = (value: unknown): string => validDisplayName(value) ? value : '名前不明';
export function createAuthorLabel(authorChannelId: string, displayName?: string) {
  const label = document.createElement('div'); label.className = 'author-label';
  const name = document.createElement('span'); name.className = 'author-name'; name.textContent = displayAuthorName(displayName);
  const details = document.createElement('details'); details.className = 'author-details';
  const summary = document.createElement('summary'); summary.textContent = '投稿者ID';
  const id = document.createElement('span'); id.textContent = authorChannelId;
  details.append(summary, id); label.append(name, details);
  return label;
}
