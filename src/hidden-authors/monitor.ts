import type { runtime } from '../extension-runtime';
import { createNotice } from '../ui-notice';
import { createAuthorLabel, displayAuthorName } from '../author-label';
import { createHiddenAuthorSnapshot } from './snapshot';
import { t } from '../i18n';
export function createHiddenAuthorPanel(main: HTMLElement, transport: Pick<typeof runtime, 'sendMessage'>, changed: () => void = () => {}) {
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
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = t('retryHidden'); retry.hidden = true;
  section.append(heading, status, retry, empty, list, note); main.append(section);
  let video: string | undefined; let generation = 0; let signature = '';
  const snapshot = createHiddenAuthorSnapshot({ read: selected => transport.sendMessage({ type: 'hidden.list', videoId: selected }), changed(state) {
      changed();
      retry.hidden = state.status !== 'error';
      list.hidden = state.status !== 'ready';
      empty.hidden = state.status !== 'ready' || state.authors.length > 0;
      if (state.status !== 'ready') { status.textContent = t(state.status === 'error' ? 'hiddenListFailure' : video ? 'checkingList' : 'selectStream'); return; }
      const current = generation; const selected = video;
      const authors = state.authors;
      const next = JSON.stringify(authors);
      empty.hidden = authors.length > 0;
      status.textContent = t('hiddenCount', authors.length);
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
            signature = ''; void snapshot.refresh();
          }).catch(() => { if (current === generation) { remove.disabled = false; status.textContent = t('unhideFailure'); } });
        });
        item.append(remove); list.append(item);
      }
  } });
  retry.addEventListener('click', () => { void snapshot.refresh(); });
  setInterval(() => { void snapshot.poll(); }, 1000);
  return { refresh(block?: boolean) { void snapshot.refresh(block); }, visible: snapshot.visible, state: snapshot.state,
    setVideo(value: string | undefined) { generation++; video = value; signature = ''; list.replaceChildren(); empty.hidden = true; void snapshot.setVideo(value); } };
}
