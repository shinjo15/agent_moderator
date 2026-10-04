import { runtime } from './extension-runtime';
import { createChatMonitor } from './youtube/monitor';
import { createRuntimeTransport } from './youtube/runtime-transport';

const main = document.querySelector('main')!;
const heading = document.createElement('h1');
heading.textContent = 'YouTubeライブチャット取得';
const notice = document.createElement('p');
notice.textContent = 'このページを開いている間、YouTube視聴タブが前面でも取得を継続します。裏のタブではブラウザにより取得が遅くなる場合があります。ページを閉じると停止します。初回取得は過去全履歴を保証しません。Jev判定・非表示・BANは行いません。';
const target = document.createElement('p');
const status = document.createElement('p');
status.setAttribute('role', 'status');
const start = document.createElement('button');
start.textContent = '取得を開始'; start.disabled = true;
const stop = document.createElement('button');
stop.textContent = '取得を停止'; stop.disabled = true;
const settings = document.createElement('a');
settings.href = 'options.html'; settings.target = '_blank'; settings.textContent = 'APIキー設定を開く';
const messages = document.createElement('ol');
messages.id = 'messages';
main.append(heading, notice, target, start, stop, settings, status, messages);
let available = false;
let validTarget = false;
let initializationGeneration = 0;
const monitor = createChatMonitor({ transport: createRuntimeTransport(),
  onMessages: batch => {
    for (const message of batch) {
      const item = document.createElement('li');
      item.textContent = `${message.authorChannelId}: ${message.text}`;
      messages.append(item);
    }
  },
  onState: state => {
    start.disabled = state.status === 'running' || !available || !validTarget;
    stop.disabled = state.status !== 'running';
    status.textContent = state.error?.message ?? ({ running: 'ライブチャットを取得中です。', stopped: '取得を停止しました。', ended: 'ライブ配信またはチャットは終了しました。', error: '取得に失敗しました。' })[state.status];
  },
});
start.addEventListener('click', () => monitor.start());
stop.addEventListener('click', () => monitor.stop());
// hiddenだけでは停止しない。YouTube視聴中の継続がこの機能の目的。
window.addEventListener('pagehide', () => monitor.stop());
runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== runtime.id || (sender.url !== undefined && sender.url !== runtime.getURL('background.js'))
    || typeof message !== 'object' || message === null || !('type' in message)) return false;
  if (message.type === 'youtube.credentialsChanged' && 'available' in message && typeof message.available === 'boolean') {
    initializationGeneration++;
    available = message.available;
    monitor.credentialsChanged(available);
    status.textContent = available ? 'YouTubeキーが変更されたため停止しました。明示的に再開してください。' : 'YouTubeキーが未設定のため停止しました。設定してください。';
  }
  if (message.type === 'youtube.targetChanged') {
    initializationGeneration++;
    validTarget = false;
    monitor.setVideo(undefined);
    start.disabled = true;
    target.textContent = '視聴タブが変更または閉じられました。YouTube視聴タブの拡張ポップアップから選び直してください。';
  }
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
    monitor.setVideo(response.value.videoId);
    monitor.credentialsChanged(available);
    status.textContent = available ? '開始ボタンで取得できます。' : 'YouTubeキーが未設定です。設定してください。';
  } catch {
    if (generation !== initializationGeneration) return;
    status.textContent = 'YouTube視聴タブの拡張ポップアップから対象動画を選択してください。';
  }
})();
