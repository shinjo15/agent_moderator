import type { runtime } from '../extension-runtime';
export function createHiddenDataPanel(main: HTMLElement, transport: Pick<typeof runtime, 'sendMessage'>) {
  const section = document.createElement('section'); section.className = 'credential-card';
  const title = document.createElement('h2'); title.id = 'hidden-clear-title'; title.className = 'credential-title'; title.textContent = '全配信の非表示データを削除';
  section.setAttribute('aria-labelledby', title.id);
  const note = document.createElement('p'); note.className = 'credential-help';
  note.textContent = '全配信の非表示投稿者ID・保存済みの名前・解除の世代情報・空の保存項目を、このブラウザから削除します。';
  const open = document.createElement('button'); open.type = 'button'; open.className = 'credential-delete'; open.textContent = '全配信の非表示データを削除';
  const status = document.createElement('p'); status.setAttribute('aria-live', 'polite'); status.dataset.testid = 'hidden-clear-status';
  const dialog = document.createElement('dialog'); dialog.setAttribute('aria-labelledby', 'hidden-clear-confirm');
  const heading = document.createElement('h2'); heading.id = 'hidden-clear-confirm'; heading.textContent = '全配信の非表示データを削除しますか？';
  const explanation = document.createElement('p');
  explanation.textContent = '取得と判定を停止し、全配信の非表示を解除します。投稿者ID・保存済みの名前・解除の世代情報・空の保存項目を削除します。APIキーと判定の基準値などの設定は残します。APIの待機期限も保持します。YouTube上の投稿やGoogle／TypeSafeへ送信済みの情報は削除しません。元に戻せません。後で明示的に取得・判定を再開すると、新しい判定で再び非表示になることがあります。';
  const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'credential-delete'; confirm.textContent = '削除する';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'キャンセル';
  const actions = document.createElement('div'); actions.className = 'credential-actions'; actions.append(cancel, confirm);
  dialog.append(heading, explanation, actions);
  open.addEventListener('click', () => { dialog.showModal(); cancel.focus(); });
  cancel.addEventListener('click', () => dialog.close());
  confirm.addEventListener('click', () => {
    dialog.close(); open.disabled = true; status.textContent = '非表示データを削除中です。';
    void (async () => {
      try {
        const result = await transport.sendMessage({ type: 'hidden.clearAll' }) as { ok?: boolean } | null;
        if (result?.ok !== true) throw new Error('Deletion failed');
        status.textContent = '全配信の非表示データを削除しました。APIキーと判定の基準値は保持しています。再開はチャット画面で操作してください。';
      } catch { status.textContent = '削除を確認できませんでした。一部のデータが残っている可能性があります。取得と判定は停止しています。もう一度削除を操作してください。'; }
      finally { open.disabled = false; }
    })();
  });
  section.append(title, note, open, status, dialog); main.append(section);
}
