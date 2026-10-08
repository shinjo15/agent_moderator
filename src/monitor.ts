import { runtime } from './extension-runtime';
import { createChatMonitor } from './youtube/monitor';
import { createRuntimeTransport } from './youtube/runtime-transport';
import { createModerationTransport } from './jev/runtime-transport';
import { createJevPanel } from './jev/monitor';
import { createHiddenAuthorPanel } from './hidden-authors/monitor';
import { MAX_VISIBLE_MESSAGES } from './retention';
import { createNotice } from './ui-notice';
import { createAuthorLabel } from './author-label';

const main = document.querySelector('main')!;
const heading = document.createElement('h1');
heading.textContent = 'YouTubeライブチャット取得';
const notice = createNotice('monitor-notice', [
  'この画面を開いている間は、YouTubeの視聴中も取得を続けます。別のタブやウィンドウの裏にあると、取得が遅れる場合があります。',
], [
  'この画面を閉じると取得・判定は停止します。登録済みの非表示は続きます。解除は上の一覧から行ってください。',
  'ライブ配信中のチャットのみ対象です。終了済み配信のチャット再生には対応していません。初回に過去のコメントをすべて取得できるとは限りません。',
]);
const target = document.createElement('p');
const status = document.createElement('p');
status.setAttribute('role', 'status');
const start = document.createElement('button');
start.type = 'button';
start.textContent = '取得を開始'; start.disabled = true;
const stop = document.createElement('button');
stop.type = 'button';
stop.textContent = '取得を停止'; stop.disabled = true;
const settings = document.createElement('a');
settings.href = 'options.html'; settings.target = '_blank'; settings.textContent = '設定を開く';
const messages = document.createElement('ol');
messages.id = 'messages';
const controls = document.createElement('section');
controls.className = 'monitor-controls';
const actions = document.createElement('div');
actions.className = 'monitor-actions';
actions.append(start, stop, settings);
controls.append(target, actions, status);
main.append(heading, controls);
const jev = createJevPanel(controls, createModerationTransport(runtime));
const chatHeading = document.createElement('h2');
chatHeading.textContent = '取得コメント';
chatHeading.id = 'chat-heading';
const scoreNote = createNotice('monitor-note', [
  `表示は直近${MAX_VISIBLE_MESSAGES}件です。投稿者の照合は投稿者IDで行います。`,
  '判定スコアは7項目の最高値です（小数点以下2桁）。正確さを保証する数値ではありません。',
  '「項目別スコア」には丸め前の数値を表示し、判定にもこの数値を使います。',
  '処理が追いつかない場合や古いコメントは、未判定のまま処理を終えることがあります。未判定は「該当なし」ではありません。',
]);
const chat = document.createElement('div');
chat.className = 'chat-scroll';
chat.setAttribute('role', 'region');
chat.setAttribute('aria-labelledby', chatHeading.id);
chat.tabIndex = 0;
const empty = document.createElement('p');
empty.className = 'empty-list';
empty.textContent = 'コメントはまだありません。';
chat.append(empty, messages);
const atBottom = () => chat.scrollHeight - chat.clientHeight - chat.scrollTop <= 2;
let followLatest = true;
chat.addEventListener('scroll', () => { followLatest = atBottom(); });
// 評価表示で行の高さが変わっても、過去を読んでいる利用者は末尾へ移動しない。
new ResizeObserver(() => {
  if (followLatest) chat.scrollTop = chat.scrollHeight;
}).observe(messages);
main.append(chatHeading, scoreNote, chat);
const hidden = createHiddenAuthorPanel(main, runtime);
main.append(notice);
// Reload never inherits the previous page's opt-in or body context.
void createModerationTransport(runtime).stop(true);
let available = false;
let validTarget = false;
let initializationGeneration = 0;
const monitor = createChatMonitor({ transport: createRuntimeTransport(),
  onMessages: batch => {
    followLatest = atBottom();
    empty.hidden = true;
    for (const message of batch) {
      const item = document.createElement('li');
      item.className = 'chat-message';
      const content = document.createElement('div');
      content.className = 'chat-content';
      const author = createAuthorLabel(message.authorChannelId, message.authorDisplayName);
      author.classList.add('chat-author');
      const text = document.createElement('span');
      text.className = 'chat-text';
      text.textContent = message.text;
      content.append(author, text);
      item.append(content);
      messages.append(item);
      while (messages.children.length > MAX_VISIBLE_MESSAGES) jev.remove(messages.firstElementChild as HTMLElement);
      jev.add(message.id, message.authorChannelId, item);
    }
    if (followLatest) chat.scrollTop = chat.scrollHeight;
  },
  onState: state => {
    start.disabled = state.status === 'running' || !available || !validTarget;
    stop.disabled = state.status !== 'running';
    status.textContent = state.error?.message ?? ({ running: 'ライブチャットを取得中です。', stopped: '取得を停止しました。', ended: 'ライブ配信またはチャットは終了しました。', error: '取得に失敗しました。' })[state.status];
  },
});
start.addEventListener('click', () => monitor.start());
stop.addEventListener('click', () => { jev.stop(undefined, true); monitor.stop(); });
// hiddenだけでは停止しない。YouTube視聴中の継続がこの機能の目的。
window.addEventListener('pagehide', () => { jev.stop(undefined, true); monitor.stop(); });
runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== runtime.id || (sender.url !== undefined && sender.url !== runtime.getURL('background.js'))
    || typeof message !== 'object' || message === null || !('type' in message)) return false;
  if (message.type === 'hidden.clearing' || message.type === 'hidden.refresh') {
    jev.stop('非表示データの削除のためJev判定を停止しました。再開は明示的に操作してください。', true);
    monitor.credentialsChanged(available);
    hidden.refresh();
    status.textContent = '非表示データの削除のため取得・判定を停止しました。再開するには「取得を開始」を押してください。';
  }
  if (message.type === 'youtube.credentialsChanged' && 'available' in message && typeof message.available === 'boolean') {
    jev.stop('YouTubeキー変更のためJev判定も停止しました。', true);
    initializationGeneration++;
    available = message.available;
    monitor.credentialsChanged(available);
    status.textContent = available ? 'YouTube APIキーが変更されたため停止しました。「取得を開始」で再開してください。' : 'YouTube APIキーが未設定のため停止しました。設定画面で保存してください。';
  }
  if (message.type === 'youtube.targetChanged') {
    hidden.setVideo(undefined);
    jev.stop(); jev.setTarget(false);
    initializationGeneration++;
    validTarget = false;
    monitor.setVideo(undefined);
    start.disabled = true;
    target.textContent = '視聴タブが変更または閉じられました。YouTube視聴タブの拡張ポップアップから選び直してください。';
  }
  if (message.type === 'jev.credentialsChanged') jev.stop('Jev APIキーの変更・削除のため判定を停止しました。設定を確認し、「Jev判定を有効化・再開」を押してください。');
  return false;
});
void (async () => {
  const generation = initializationGeneration;
  try {
    const response = await runtime.sendMessage({ type: 'youtube.status' });
    if (generation !== initializationGeneration) return;
    if (typeof response !== 'object' || response === null || !('ok' in response) || response.ok !== true
      || !('value' in response) || typeof response.value !== 'object' || response.value === null
      || !('videoId' in response.value) || typeof response.value.videoId !== 'string'
      || !('credentialsAvailable' in response.value) || typeof response.value.credentialsAvailable !== 'boolean') throw new Error();
    validTarget = true;
    available = response.value.credentialsAvailable;
    target.textContent = `対象動画: ${response.value.videoId}`;
    hidden.setVideo(response.value.videoId);
    monitor.setVideo(response.value.videoId);
    monitor.credentialsChanged(available);
    jev.setTarget(true);
    status.textContent = available ? '「取得を開始」を押してください。' : 'YouTube APIキーが未設定です。設定画面で保存してください。';
  } catch {
    if (generation !== initializationGeneration) return;
    status.textContent = 'YouTube視聴タブの拡張ポップアップから対象動画を選択してください。';
  }
})();
