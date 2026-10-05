import type { runtime } from '../extension-runtime';
import { validAuthor } from './store';
export function createHiddenAuthorPanel(main: HTMLElement, transport: Pick<typeof runtime, 'sendMessage'>) {
  const section = document.createElement('section');
  const heading = document.createElement('h2'); heading.textContent = 'この配信の非表示投稿者';
  const note = document.createElement('p'); note.textContent = '非表示は配信video IDごとに端末内へ保存され、監視停止・キー削除・ブラウザ再起動では解除されません。解除は既存・新着へ反映します。解除前に取得した同じ判定は再登録しませんが、新しい投稿が悪質なら再登録します。';
  const status = document.createElement('p'); status.setAttribute('aria-live', 'polite');
  const list = document.createElement('ul'); list.id = 'hidden-authors';
  section.append(heading, note, status, list); main.append(section);
  let video: string | undefined; let generation = 0; let signature = '';
  async function refresh() {
    const current = generation; const selected = video;
    if (!selected) return;
    try {
      const result = await transport.sendMessage({ type: 'hidden.list', videoId: selected }) as { ok?: boolean; ids?: unknown };
      if (current !== generation) return;
      if (result.ok !== true || !Array.isArray(result.ids)) { status.textContent = '対象配信のリストを確認できません。'; return; }
      const ids = result.ids.filter(validAuthor); const next = JSON.stringify(ids);
      status.textContent = `対象動画: ${selected} / ${ids.length}人を非表示`;
      if (signature === next) return; signature = next; list.replaceChildren();
      for (const author of ids) {
        const item = document.createElement('li'); item.append(document.createTextNode(author));
        const remove = document.createElement('button'); remove.textContent = '非表示を解除'; remove.setAttribute('aria-label', `${author} の非表示を解除`);
        remove.addEventListener('click', () => {
          remove.disabled = true;
          void transport.sendMessage({ type: 'hidden.remove', videoId: selected, authorChannelId: author }).then(result => {
            if (current !== generation) return;
            if (!(result as { ok?: boolean })?.ok) status.textContent = '解除できませんでした。対象配信を確認してください。';
            signature = ''; void refresh();
          }).catch(() => { if (current === generation) { remove.disabled = false; status.textContent = '解除に失敗しました。'; } });
        });
        item.append(remove); list.append(item);
      }
    } catch { if (current === generation) status.textContent = 'リストを確認できません。'; }
  }
  setInterval(() => { void refresh(); }, 1000);
  return { setVideo(value: string | undefined) { generation++; video = value; signature = ''; list.replaceChildren(); status.textContent = value ? 'リストを確認中です。' : '対象配信を選択してください。'; void refresh(); } };
}
