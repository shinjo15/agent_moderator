import type { runtime } from '../extension-runtime';
import { validAuthor } from './store';
import { createNotice } from '../ui-notice';
import { createAuthorLabel, displayAuthorName } from '../author-label';
import { validDisplayName } from '../youtube/contracts';
import type { HiddenAuthor } from './store';
export function createHiddenAuthorPanel(main: HTMLElement, transport: Pick<typeof runtime, 'sendMessage'>) {
  const section = document.createElement('section');
  section.className = 'hidden-author-panel';
  const heading = document.createElement('h2'); heading.textContent = 'この配信の非表示投稿者';
  const note = createNotice('monitor-note', [], [
    '非表示の投稿者と取得済みの名前は配信ごとに、このブラウザに保存します。停止・APIキー削除・ブラウザ再起動では解除されません。',
    '「非表示を解除」で、その投稿者の既存・新着コメントを再び表示します。反映まで時間がかかることがあります。',
    '解除前の判定結果では再登録しません。ただし、解除後に新たに取得したコメントが悪質と判定されると、再び非表示になります。',
  ]);
  const status = document.createElement('p'); status.setAttribute('aria-live', 'polite');
  const list = document.createElement('ul'); list.id = 'hidden-authors';
  const empty = document.createElement('p'); empty.className = 'empty-list'; empty.textContent = 'この配信の非表示投稿者はいません。'; empty.hidden = true;
  section.append(heading, status, empty, list, note); main.append(section);
  let video: string | undefined; let generation = 0; let signature = '';
  async function refresh() {
    const current = generation; const selected = video;
    if (!selected) return;
    try {
      const result = await transport.sendMessage({ type: 'hidden.list', videoId: selected }) as { ok?: boolean; videoId?: unknown; ids?: unknown; authors?: unknown };
      if (current !== generation) return;
      if (result.ok !== true || result.videoId !== selected || !Array.isArray(result.ids) || !result.ids.every(validAuthor)) {
        status.textContent = '非表示一覧を確認できません。対象配信を選び直してください。'; return;
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
      status.textContent = `非表示の投稿者：${ids.length}件`;
      if (signature === next) return; signature = next; list.replaceChildren();
      for (const { authorChannelId: author, displayName } of authors) {
        const item = document.createElement('li');
        const label = createAuthorLabel(author, displayName); label.classList.add('hidden-author-label'); item.append(label);
        const remove = document.createElement('button'); remove.textContent = '非表示を解除';
        remove.setAttribute('aria-label', `${displayAuthorName(displayName)}（投稿者ID：${author}）の非表示を解除`);
        remove.type = 'button';
        remove.addEventListener('click', () => {
          remove.disabled = true;
          void transport.sendMessage({ type: 'hidden.remove', videoId: selected, authorChannelId: author }).then(result => {
            if (current !== generation) return;
            if (!(result as { ok?: boolean })?.ok) status.textContent = '解除できませんでした。対象配信を確認してください。';
            signature = ''; void refresh();
          }).catch(() => { if (current === generation) { remove.disabled = false; status.textContent = '解除に失敗しました。もう一度「非表示を解除」を押してください。'; } });
        });
        item.append(remove); list.append(item);
      }
    } catch { if (current === generation) status.textContent = '非表示一覧を確認できません。対象配信を選び直してください。'; }
  }
  setInterval(() => { void refresh(); }, 1000);
  return { refresh() { generation++; signature = ''; void refresh(); },
    setVideo(value: string | undefined) { generation++; video = value; signature = ''; list.replaceChildren(); empty.hidden = true; status.textContent = value ? 'リストを確認中です。' : '対象配信を選択してください。'; void refresh(); } };
}
