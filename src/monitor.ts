import { runtime } from './extension-runtime';
import { createChatMonitor } from './youtube/monitor';
import { createRuntimeTransport } from './youtube/runtime-transport';
import { createModerationTransport } from './jev/runtime-transport';
import { createJevPanel } from './jev/monitor';
import { createHiddenAuthorPanel } from './hidden-authors/monitor';
import { MAX_VISIBLE_MESSAGES } from './retention';
import { createNotice } from './ui-notice';
import { createAuthorLabel } from './author-label';
import { t, initializePage } from './i18n';

initializePage('monitorTitle');

const main = document.querySelector('main')!;
const heading = document.createElement('h1');
heading.textContent = t('monitorTitle');
const notice = createNotice('monitor-notice', [
  t('monitorContinue'),
], [
  t('monitorClose'),
  t('monitorLiveOnly'),
]);
const target = document.createElement('p');
const status = document.createElement('p');
status.setAttribute('role', 'status');
const start = document.createElement('button');
start.type = 'button';
start.textContent = t('startCollection'); start.disabled = true;
const stop = document.createElement('button');
stop.type = 'button';
stop.textContent = t('stopCollection'); stop.disabled = true;
const settings = document.createElement('a');
settings.href = 'options.html'; settings.target = '_blank'; settings.textContent = t('openSettings');
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
chatHeading.textContent = t('collectedComments');
chatHeading.id = 'chat-heading';
const scoreNote = createNotice('monitor-note', [
  t('visibleLimit', MAX_VISIBLE_MESSAGES),
  t('scoreNote'),
  t('scoreRawNote'),
  t('unjudgedNote'),
]);
const chat = document.createElement('div');
chat.className = 'chat-scroll';
chat.setAttribute('role', 'region');
chat.setAttribute('aria-labelledby', chatHeading.id);
chat.tabIndex = 0;
const empty = document.createElement('p');
empty.className = 'empty-list';
empty.textContent = t('noComments');
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
    // This local retention failure shares unavailable with provider outages. Match only
    // the known fixed context; never render arbitrary transport error.message text.
    const overflow = state.error?.code === 'unavailable' && state.error.message === 'コメントが多く、取得を停止しました。未処理のコメントは未判定です。60秒後に「取得を開始」を押してください。';
    status.textContent = overflow ? t('collectionOverflow') : state.error
      ? t(state.error.code === 'confirmationRequired' ? 'confirmationRequired' : `youtube_${state.error.code}`)
      : t(`collection_${state.status}`);
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
    jev.stop(t('clearJevStop'), true);
    monitor.credentialsChanged(available);
    hidden.refresh();
    status.textContent = t('clearCollectionStop');
  }
  if (message.type === 'confirmation.changed') {
    monitor.stop(); jev.stop(t('confirmationRequired'), true);
    status.textContent = t('agreementChanged');
  }
  if (message.type === 'youtube.credentialsChanged' && 'available' in message && typeof message.available === 'boolean') {
    jev.stop(t('youtubeKeyJevStop'), true);
    initializationGeneration++;
    available = message.available;
    monitor.credentialsChanged(available);
    status.textContent = t(available ? 'youtubeKeyChanged' : 'youtubeKeyMissingStop');
  }
  if (message.type === 'youtube.targetChanged') {
    hidden.setVideo(undefined);
    jev.stop(); jev.setTarget(false);
    initializationGeneration++;
    validTarget = false;
    monitor.setVideo(undefined);
    start.disabled = true;
    target.textContent = t('targetChanged');
  }
  if (message.type === 'jev.credentialsChanged') jev.stop(t('jevKeyChanged'));
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
    target.textContent = t('targetVideo', response.value.videoId);
    hidden.setVideo(response.value.videoId);
    monitor.setVideo(response.value.videoId);
    monitor.credentialsChanged(available);
    jev.setTarget(true);
    status.textContent = t(available ? 'readyCollection' : 'youtubeKeyMissing');
  } catch {
    if (generation !== initializationGeneration) return;
    status.textContent = t('selectVideo');
  }
})();
