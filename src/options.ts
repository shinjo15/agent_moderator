import { runtime } from './extension-runtime';
import type { ApiKeyProvider, CredentialStatus } from './credential-store';

const heading = document.createElement('h1');
heading.textContent = 'Agent Moderator 設定';
const notice = document.createElement('p');
notice.textContent = 'キーはこの端末のchrome.storage.localだけに保存します。同期しません。ローカル保存は秘密保管庫ではなく、端末やブラウザプロファイルへアクセスできる人からは保護できません。この版では取得開始時にYouTube APIへ通信し、YouTube APIクォータは利用者が負担します。monitorでJev判定を明示有効化すると、同一投稿者の取得済み本文と投稿時刻を送信し、Jev利用料も発生します。配信別に投稿者を画面内で非表示にします。監視停止後も非表示は維持され、monitorから解除できます。YouTube上でのBAN・コメント削除は行いません。保存だけでは接続確認を行わず、設定済み表示はキーの有効性を保証しません。空欄で保存すると既存キーを保持します。';
const result = document.createElement('p');
result.setAttribute('role', 'status');
const main = document.querySelector('main')!;
main.append(heading, notice, result);
const fields = new Map<ApiKeyProvider, { input: HTMLInputElement; status: HTMLParagraphElement }>();
const buttons: HTMLButtonElement[] = [];
let busy = false;
const failure = 'キー設定の処理に失敗しました。再試行してください。';

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
  try {
    const response = await runtime.sendMessage(message);
    if (typeof response !== 'object' || response === null || !('ok' in response) || response.ok !== true ||
        !('status' in response) || typeof response.status !== 'object' || response.status === null ||
        !('jev' in response.status) || typeof response.status.jev !== 'boolean' ||
        !('youtube' in response.status) || typeof response.status.youtube !== 'boolean') {
      throw new Error(failure);
    }
    render({ jev: response.status.jev, youtube: response.status.youtube });
    result.textContent = '設定を確認しました。';
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
  const label = document.createElement('label');
  label.htmlFor = `${provider}-key`;
  label.textContent = `${name} APIキー`;
  const input = document.createElement('input');
  input.id = label.htmlFor;
  input.type = 'password';
  input.autocomplete = 'off';
  input.spellcheck = false;
  const status = document.createElement('p');
  status.dataset.testid = `${provider}-status`;
  status.textContent = '設定を確認中';
  const save = document.createElement('button');
  save.textContent = `${name}キーを保存`;
  save.addEventListener('click', () => { void request({ type: 'credentials.save', provider, value: input.value }); });
  const remove = document.createElement('button');
  remove.textContent = `${name}キーを削除`;
  remove.addEventListener('click', () => { void request({ type: 'credentials.delete', provider }); });
  buttons.push(save, remove);
  fields.set(provider, { input, status });
  section.append(label, input, status, save, remove);
  main.append(section);
}
void request({ type: 'storage.init' });
