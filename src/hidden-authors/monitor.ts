import type { runtime } from '../extension-runtime';
import { validAuthor } from './store';
import { createNotice } from '../ui-notice';
import { createAuthorLabel, displayAuthorName } from '../author-label';
import { validDisplayName } from '../youtube/contracts';
import type { HiddenAuthor } from './store';
import { t } from '../i18n';
export function createHiddenAuthorPanel(main: HTMLElement, transport: Pick<typeof runtime, 'sendMessage'>) {
  const section = document.createElement('section');
  section.className = 'hidden-author-panel';
  const heading = document.createElement('h2'); heading.textContent = t('hiddenTitle');
  const note = createNotice('monitor-note', [], [
    t('hiddenStorage'),
    t('unhideNote'),
    t('unhideRejudge'),
  ]);
  const status = document.createElement('p'); status.setAttribute('aria-live', 'polite');
  const list = document.createElement('ul'); list.id = 'hidden-authors';
  const empty = document.createElement('p'); empty.className = 'empty-list'; empty.textContent = t('noHiddenAuthors'); empty.hidden = true;
  section.append(heading, status, empty, list, note); main.append(section);
  let video: string | undefined; let generation = 0; let signature = '';
  async function refresh() {
    const current = generation; const selected = video;
    if (!selected) return;
    try {
      const result = await transport.sendMessage({ type: 'hidden.list', videoId: selected }) as { ok?: boolean; videoId?: unknown; ids?: unknown; authors?: unknown };
      if (current !== generation) return;
      if (result.ok !== true || result.videoId !== selected || !Array.isArray(result.ids) || !result.ids.every(validAuthor)) {
        status.textContent = t('hiddenListFailure'); return;
      }
      const ids = result.ids;
      const authors: HiddenAuthor[] = ids.map(authorChannelId => ({ authorChannelId }));
      if (result.authors !== undefined) {
        if (!Array.isArray(result.authors) || result.authors.length !== ids.length) throw new Error('Invalid author list');
        for (let i = 0; i < authors.length; i++) {
          const value = result.authors[i] as HiddenAuthor | null;
          if (!value || typeof value !== 'object' || Array.isArray(value) || value.authorChannelId !== ids[i]
            || (value.displayName !== undefined && !validDisplayName(value.displayName))) throw new Error('Invalid author');
          if (value.displayName !== undefined) authors[i].displayName = value.displayName;
        }
      }
      const next = JSON.stringify(authors);
      empty.hidden = ids.length > 0;
      status.textContent = t('hiddenCount', ids.length);
      if (signature === next) return; signature = next; list.replaceChildren();
      for (const { authorChannelId: author, displayName } of authors) {
        const item = document.createElement('li');
        const label = createAuthorLabel(author, displayName); label.classList.add('hidden-author-label'); item.append(label);
        const remove = document.createElement('button'); remove.textContent = t('unhide');
        remove.setAttribute('aria-label', t('unhideAria', displayAuthorName(displayName), author));
        remove.type = 'button';
        remove.addEventListener('click', () => {
          remove.disabled = true;
          void transport.sendMessage({ type: 'hidden.remove', videoId: selected, authorChannelId: author }).then(result => {
            if (current !== generation) return;
            if (!(result as { ok?: boolean })?.ok) status.textContent = t('unhideTargetFailure');
            signature = ''; void refresh();
          }).catch(() => { if (current === generation) { remove.disabled = false; status.textContent = t('unhideFailure'); } });
        });
        item.append(remove); list.append(item);
      }
    } catch { if (current === generation) status.textContent = t('hiddenListFailure'); }
  }
  setInterval(() => { void refresh(); }, 1000);
  return { refresh() { generation++; signature = ''; void refresh(); },
    setVideo(value: string | undefined) { generation++; video = value; signature = ''; list.replaceChildren(); empty.hidden = true; status.textContent = t(value ? 'checkingList' : 'selectStream'); void refresh(); } };
}
