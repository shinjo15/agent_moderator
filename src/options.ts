import { runtime } from './extension-runtime';
import type { ApiKeyProvider, CredentialStatus } from './credential-store';
import { createNotice } from './ui-notice';

const heading = document.createElement('h1');
heading.textContent = 'Agent Moderator 設定';
const notice = createNotice('settings-notice', [
  '「設定済み」はAPIキーの保存状況です。保存だけでは接続・認証の確認をせず、キーが使えることは保証しません。',
], [
  'APIキー・設定・非表示の投稿者IDは、このブラウザの利用環境に保存します。他の端末には同期しません。端末やブラウザのデータにアクセスできる人からは保護できません。',
  '「取得を開始」でYouTubeへ通信します。YouTube APIの利用枠（クォータ）は利用者負担です。',
  'Jev判定を有効にすると、取得したコメントの本文と投稿時刻をJevへ送信します。Jevの利用料金は利用者負担です。',
  '非表示は配信ごとに、あなたの画面だけに適用されます。停止しても非表示は続き、チャット画面の一覧から解除できます。YouTube上のBANやコメント削除はしません。',
]);
const result = document.createElement('p');
result.setAttribute('role', 'status');
const main = document.querySelector('main')!;
main.append(heading, result);
const fields = new Map<ApiKeyProvider, { input: HTMLInputElement; status: HTMLParagraphElement }>();
const buttons: HTMLButtonElement[] = [];
let busy = false;
const failure = 'APIキーの設定に失敗しました。もう一度操作してください。保存する場合はキーを入力し直してください。';

function render(status: CredentialStatus) {
  for (const [provider, field] of fields) {
    field.status.textContent = status[provider] ? '設定済み' : '未設定：設定が必要です。';
  }
}

type CredentialRequest =
  | { type: 'storage.init' }
  | { type: 'credentials.save'; provider: ApiKeyProvider; value: string }
  | { type: 'credentials.delete'; provider: ApiKeyProvider };

async function request(message: CredentialRequest) {
  if (busy) return;
  busy = true;
  for (const button of buttons) button.disabled = true;
  result.textContent = message.type === 'storage.init' ? 'APIキーの保存状況を確認中です。' : 'APIキーの設定を処理中です。';
  try {
    const response = await runtime.sendMessage(message);
    if (typeof response !== 'object' || response === null || !('ok' in response) || response.ok !== true ||
        !('status' in response) || typeof response.status !== 'object' || response.status === null ||
        !('jev' in response.status) || typeof response.status.jev !== 'boolean' ||
        !('youtube' in response.status) || typeof response.status.youtube !== 'boolean') {
      throw new Error(failure);
    }
    render({ jev: response.status.jev, youtube: response.status.youtube });
    result.textContent = message.type === 'storage.init' ? 'APIキーの保存状況を確認しました。'
      : message.type === 'credentials.save' ? 'APIキーの保存処理が完了しました。有効性は確認していません。' : 'APIキーの削除処理が完了しました。';
  } catch {
    result.textContent = failure;
  } finally {
    // Clear only the operated provider, even on failure. Init submits no key.
    if (message.type !== 'storage.init') fields.get(message.provider)!.input.value = '';
    busy = false;
    for (const button of buttons) button.disabled = false;
  }
}

for (const [provider, name] of [['jev', 'Jev'], ['youtube', 'YouTube']] as const) {
  const section = document.createElement('section');
  section.className = 'credential-card';
  const title = document.createElement('h2');
  title.id = `${provider}-title`;
  title.className = 'credential-title';
  title.textContent = `${name}：${provider === 'jev' ? 'コメント判定' : 'チャット取得'}`;
  section.setAttribute('aria-labelledby', title.id);
  const description = document.createElement('p');
  description.id = `${provider}-description`;
  description.className = 'credential-help';
  description.textContent = provider === 'jev' ?
    'コメントのAI判定に使います。チャット画面でJev判定を有効にすると利用します。' :
    'ライブチャットの取得に使います。「取得を開始」を押すと利用します。';
  const label = document.createElement('label');
  label.className = 'credential-label';
  label.htmlFor = `${provider}-key`;
  label.textContent = `${name} APIキー`;
  const input = document.createElement('input');
  input.className = 'credential-input';
  input.id = label.htmlFor;
  input.type = 'password';
  input.placeholder = `${name} APIキーを入力`;
  input.setAttribute('aria-describedby', description.id);
  input.autocomplete = 'off';
  input.spellcheck = false;
  const status = document.createElement('p');
  status.className = 'credential-status';
  status.dataset.testid = `${provider}-status`;
  status.textContent = '設定を確認中';
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'credential-save';
  save.textContent = `${name}キーを保存`;
  save.addEventListener('click', () => { void request({ type: 'credentials.save', provider, value: input.value }); });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'credential-delete';
  remove.textContent = `${name}キーを削除`;
  remove.addEventListener('click', () => { void request({ type: 'credentials.delete', provider }); });
  buttons.push(save, remove);
  fields.set(provider, { input, status });
  const actions = document.createElement('div');
  actions.className = 'credential-actions';
  actions.append(save, remove);
  section.append(title, description, label, input, status, actions);
  main.append(section);
}
main.append(notice);
void request({ type: 'storage.init' });
