import type { runtime } from './extension-runtime';
import { CONFIRMATION_VERSION, confirmationRequired } from './confirmation';

export function createConfirmationPanel(main: HTMLElement, channel: Pick<typeof runtime, 'sendMessage' | 'onMessage' | 'id' | 'getURL'>) {
  const section = document.createElement('section'); section.className = 'credential-card';
  const heading = document.createElement('h2'); heading.textContent = '利用前の確認';
  const links = document.createElement('p');
  for (const [name, href] of [
    ['プライバシーポリシー（案）', 'https://github.com/shinjo15/agent_moderator/blob/main/docs/privacy.md'],
    ['YouTube利用規約', 'https://www.youtube.com/t/terms'],
    ['Googleプライバシーポリシー', 'https://policies.google.com/privacy'],
  ]) {
    const link = document.createElement('a'); link.textContent = name; link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    links.append(link, document.createElement('br'));
  }
  const explanation = document.createElement('p');
  explanation.textContent = '本拡張はYouTube API Servicesを使用し、利用者はYouTube利用規約に拘束されます。利用条件とデータの扱いを確認してから、取得・判定を開始してください。キーは確認前でも保存できます。通常のYouTubeページの閲覧は対象外です。';
  const jev = document.createElement('p'); jev.className = 'sending-disclosure';
  jev.textContent = 'Jev判定の送信先はTypeSafe AIです。悪質性の判定のため、対象コメントの本文と投稿時刻、および同じ投稿者の60秒以内の取得済みコメント（対象を含め最大20件）を送信します。本文には個人情報が含まれ得ます。YouTube APIの利用枠とJevの利用料金は利用者負担です。確認後もJev判定の明示有効化が必要です。';
  const limits = document.createElement('p'); limits.className = 'credential-help';
  limits.textContent = 'この確認は投稿者本人の同意ではありません。第三者の投稿の送信条件、提供元の規約適合、正式施行・一般配布は未確認です。掲載中のポリシーは案で、公開可能であることを保証しません。';
  const persistence = document.createElement('p'); persistence.className = 'credential-help';
  persistence.textContent = '確認した説明の版のみを、このChromeプロファイルの端末内に保存します。他の端末へ同期せず、再起動後も保持します。説明の版が変わった場合、保存情報が失われた場合や読み取れない場合は再確認が必要です。未確認の間は外部送信しません。保存エラー時は取得・判定を再開せず再確認してください。保存領域の故障時の再起動後の状態は保証できません。';
  const label = document.createElement('label');
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
  label.append(checkbox, '利用条件・データの扱いを確認しました');
  const button = document.createElement('button'); button.type = 'button'; button.className = 'credential-save'; button.textContent = '利用条件の確認を保存'; button.disabled = true;
  const status = document.createElement('p'); status.dataset.testid = 'confirmation-status'; status.setAttribute('aria-live', 'polite');
  section.append(heading, links, explanation, jev, limits, persistence, label, document.createElement('br'), button, status); main.append(section);
  let busy = true; let generation = 0; let refreshPending = false;
  checkbox.addEventListener('change', () => { button.disabled = busy || !checkbox.checked; });
  async function request(save = false) {
    const current = ++generation; busy = true; button.disabled = true;
    try {
      const response = await channel.sendMessage(save ? { type: 'confirmation.confirm', version: CONFIRMATION_VERSION } : { type: 'confirmation.get' });
      if (current !== generation) return;
      if (typeof response !== 'object' || response === null || !('ok' in response) || response.ok !== true || !('value' in response)
        || typeof response.value !== 'object' || response.value === null || !('version' in response.value) || response.value.version !== CONFIRMATION_VERSION
        || !('confirmed' in response.value) || typeof response.value.confirmed !== 'boolean' || (save && !response.value.confirmed)) throw new Error();
      checkbox.checked = response.value.confirmed;
      status.textContent = response.value.confirmed ? `確認済み（説明の版 ${CONFIRMATION_VERSION}）。取得・Jev判定は自動開始しません。` : `未確認：${confirmationRequired}`;
    } catch {
      if (current !== generation) return;
      checkbox.checked = false;
      status.textContent = '確認状態を保存・取得できませんでした。外部送信せず、もう一度確認してください。';
    } finally {
      if (current === generation) {
        busy = false; button.disabled = !checkbox.checked;
        if (refreshPending) { refreshPending = false; void request(); }
      }
    }
  }
  button.addEventListener('click', () => { if (!busy && checkbox.checked) void request(true); });
  channel.onMessage.addListener((message, sender) => {
    if (sender.id === channel.id && (sender.url === undefined || sender.url === channel.getURL('background.js'))
      && typeof message === 'object' && message !== null && 'type' in message && message.type === 'confirmation.changed') {
      if (busy) refreshPending = true; else void request();
    }
    return false;
  });
  void request();
}
