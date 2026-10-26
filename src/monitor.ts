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
const settings = document.createElement('button');
settings.type = 'button'; settings.textContent = t('openSettings');
const messages = document.createElement('ol');
messages.id = 'messages';
const controls = document.createElement('section');
controls.className = 'monitor-controls';
const actions = document.createElement('div');
actions.className = 'monitor-actions';
actions.append(start, stop, settings);
controls.append(target, actions, status);
main.append(heading, controls);
const jev = createJevPanel(controls, createModerationTransport(runtime), () => hidden.refresh());
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
let anchors: { item: Element; offset: number }[] = [];
let programmaticTop: number | undefined;
function rememberPosition() {
  if (!messages.children.length) return;
  const top = chat.getBoundingClientRect().top;
  anchors = [...messages.children].filter(item => item.getBoundingClientRect().bottom > top)
    .map(item => ({ item, offset: item.getBoundingClientRect().top - top }));
}
function restorePosition() {
  if (followLatest) chat.scrollTop = chat.scrollHeight;
  else {
    const anchor = anchors.find(value => value.item.parentNode === messages);
    if (anchor) chat.scrollTop += anchor.item.getBoundingClientRect().top - chat.getBoundingClientRect().top - anchor.offset;
  }
  programmaticTop = chat.scrollTop;
}
function synchronizeScrollPosition() {
  if (!messages.children.length || chat.scrollTop === programmaticTop) return;
  followLatest = atBottom(); rememberPosition();
}
chat.addEventListener('scroll', synchronizeScrollPosition);
// 評価表示で行の高さが変わっても、過去を読んでいる利用者は末尾へ移動しない。
new ResizeObserver(() => {
  synchronizeScrollPosition();
  if (messages.children.length) { restorePosition(); rememberPosition(); }
}).observe(messages);
main.append(chatHeading, scoreNote, chat);
// Detached rows remain bounded and can be restored by an explicit unhide, but
// their bodies are not present in the reader DOM (or its accessibility tree).
const retained: { author: string; item: HTMLElement; admitted: boolean; avatar: HTMLElement; imageUrl?: string }[] = [];
const parking = document.createDocumentFragment();
function renderMessages() {
  // scrollTop changes before its scroll event is delivered. Read that pending
  // movement before DOM updates/restoration can overwrite the reader's intent.
  synchronizeScrollPosition();
  rememberPosition();
  const visible = retained.filter(row => row.admitted && hidden.visible(row.author));
  const visibleItems = new Set(visible.map(row => row.item));
  for (const item of [...messages.children]) if (!visibleItems.has(item as HTMLElement)) parking.append(item);
  // Polls and evaluations leave unchanged rows in place, preserving text
  // selection and keyboard focus. Only new/restored rows need insertion.
  let next = messages.firstChild;
  for (const row of visible) {
    const { item, avatar } = row;
    if (item === next) next = next.nextSibling;
    else messages.insertBefore(item, next);
    // Do not assign src in parking: even detached images can start a request.
    // Admission and bounded retention have both been checked before this point.
    if (row.imageUrl) {
      const image = document.createElement('img');
      image.width = 24; image.height = 24; image.alt = ''; image.referrerPolicy = 'no-referrer';
      image.crossOrigin = 'anonymous';
      image.addEventListener('load', () => { image.hidden = false; }, { once: true });
      image.addEventListener('error', () => image.remove(), { once: true });
      image.hidden = true;
      avatar.append(image);
      image.src = row.imageUrl;
      row.imageUrl = undefined;
    }
  }
  empty.hidden = visible.length > 0;
  empty.textContent = t(hidden.state().status === 'error' ? 'hiddenReadBlocked'
    : hidden.state().status !== 'ready' ? 'checkingList' : retained.length ? 'allCommentsHidden' : 'noComments');
  restorePosition();
  if (visible.length) rememberPosition();
}
const hiddenButton = document.createElement('button'); hiddenButton.type = 'button'; hiddenButton.append(t('openHidden'));
const hiddenBadge = document.createElement('span'); hiddenBadge.className = 'hidden-count-badge'; hiddenBadge.setAttribute('aria-hidden', 'true'); hiddenBadge.textContent = '—';
const hiddenDescription = document.createElement('span'); hiddenDescription.id = 'hidden-count-description'; hiddenDescription.hidden = true; hiddenDescription.textContent = t('selectStream');
hiddenButton.setAttribute('aria-describedby', hiddenDescription.id); hiddenButton.append(hiddenBadge, hiddenDescription);
const hidden = createHiddenAuthorPanel(main, runtime, () => {
  const state = hidden.state();
  hiddenBadge.textContent = state.status === 'ready' ? String(state.authors.length) : state.status === 'error' ? '!' : state.status === 'loading' ? '…' : '—';
  hiddenDescription.textContent = state.status === 'ready' ? t('hiddenCount', state.authors.length)
    : t(state.status === 'error' ? 'hiddenListFailure' : state.status === 'loading' ? 'checkingList' : 'selectStream');
  if (hidden.state().status === 'ready') for (const row of retained) row.admitted = true;
  renderMessages();
});
main.append(notice);
function panel(title: string, className: string) {
  const dialog = document.createElement('dialog'); dialog.className = className;
  const bar = document.createElement('header'); bar.className = 'panel-header';
  const label = document.createElement('h2'); label.textContent = title; label.id = `${className}-title`;
  dialog.setAttribute('aria-labelledby', label.id);
  const close = document.createElement('button'); close.type = 'button'; close.textContent = t('closePanel');
  close.addEventListener('click', () => dialog.close());
  bar.append(label, close); dialog.append(bar); main.append(dialog);
  return dialog;
}
const hiddenDialog = panel(t('hiddenTitle'), 'hidden-dialog');
hiddenDialog.append(main.querySelector('.hidden-author-panel')!);
hiddenButton.addEventListener('click', () => hiddenDialog.showModal());
const settingsDialog = panel(t('settingsTitle'), 'settings-dialog');
settings.addEventListener('click', () => {
  if (!settingsDialog.querySelector('iframe')) {
    const frame = document.createElement('iframe'); frame.src = 'options.html'; frame.title = t('settingsTitle'); settingsDialog.append(frame);
  }
  settingsDialog.showModal();
});
const infoDialog = panel(t('viewerInfo'), 'info-dialog');
infoDialog.append(scoreNote, notice, controls.querySelector('.jev-controls .monitor-note')!);
const info = document.createElement('button'); info.type = 'button'; info.textContent = t('viewerInfo');
info.addEventListener('click', () => infoDialog.showModal());
const manage = document.createElement('button'); manage.type = 'button'; manage.textContent = t('clearTitle');
manage.addEventListener('click', () => { hiddenDialog.close(); settings.click(); });
hiddenDialog.append(manage);
actions.append(hiddenButton, info);
const header = document.createElement('header'); header.className = 'viewer-header';
const brand = document.createElement('strong'); brand.textContent = t('appName');
const identity = document.createElement('div'); identity.append(brand, heading, target);
const source = document.createElement('a'); source.href = 'https://www.youtube.com/'; source.target = '_blank'; source.rel = 'noopener noreferrer';
source.setAttribute('aria-label', t('youtubeSource'));
const logo = document.createElement('img'); logo.src = 'youtube-developed-with.png'; logo.width = 112; logo.height = 40; logo.alt = 'developed with YouTube';
source.append(logo); header.append(identity, source);
const workspace = document.createElement('section'); workspace.className = 'chat-workspace'; workspace.append(chatHeading, chat);
const jump = document.createElement('button'); jump.type = 'button'; jump.className = 'jump-latest'; jump.textContent = t('jumpLatest'); jump.hidden = true;
workspace.append(jump);
jump.addEventListener('click', () => { followLatest = true; chat.scrollTop = chat.scrollHeight; jump.hidden = true; });
chat.addEventListener('scroll', () => { jump.hidden = followLatest; });
main.prepend(header, workspace); main.append(controls);
// Reload never inherits the previous page's opt-in or body context.
void createModerationTransport(runtime).stop(true);
let available = false;
let validTarget = false;
let initializationGeneration = 0;
let followIntent = false;
const monitor = createChatMonitor({ transport: createRuntimeTransport(),
  onResolved: active => jev.resolved(active),
  onMessages: batch => {
    for (const message of batch) {
      const item = document.createElement('li');
      item.className = 'chat-message';
      const content = document.createElement('div');
      content.className = 'chat-content';
      const author = createAuthorLabel(message.authorChannelId, message.authorDisplayName);
      author.classList.add('chat-author');
      const avatar = document.createElement('span');
      avatar.className = 'chat-avatar'; avatar.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'chat-text';
      text.textContent = message.text;
      content.append(avatar, author, text);
      item.append(content);
      parking.append(item);
      retained.push({ author: message.authorChannelId, item, admitted: false, avatar, imageUrl: message.authorProfileImageUrl });
      while (retained.length > MAX_VISIBLE_MESSAGES) jev.remove(retained.shift()!.item);
      jev.add(message.id, message.authorChannelId, item);
    }
    // A new batch may already have registered a burst in background storage.
    // Never admit its rows using the previous snapshot.
    hidden.refresh();
  },
  onState: state => {
    if (state.status === 'error' || state.status === 'ended') { followIntent = false; jev.stop(undefined, true); }
    start.disabled = followIntent || state.status === 'running' || !available || !validTarget;
    stop.disabled = !followIntent && state.status !== 'running';
    // This local retention failure shares unavailable with provider outages. Match only
    // the known fixed context; never render arbitrary transport error.message text.
    const overflow = state.error?.code === 'unavailable' && state.error.message === 'コメントが多く、取得を停止しました。未処理のコメントは未判定です。60秒後に「取得を開始」を押してください。';
    status.textContent = overflow ? t('collectionOverflow') : state.error
      ? t(state.error.code === 'confirmationRequired' ? 'confirmationRequired' : `youtube_${state.error.code}`)
      : t(`collection_${state.status}`);
  },
});
start.addEventListener('click', () => monitor.start());
stop.addEventListener('click', () => { followIntent = false; jev.stop(undefined, true); monitor.stop(); });
// hiddenだけでは停止しない。YouTube視聴中の継続がこの機能の目的。
window.addEventListener('pagehide', () => { followIntent = false; jev.stop(undefined, true); monitor.stop(); });
runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== runtime.id || (sender.url !== undefined && sender.url !== runtime.getURL('background.js'))
    || typeof message !== 'object' || message === null || !('type' in message)) return false;
  if (message.type === 'hidden.scopeChanged') hidden.refresh(true);
  if (message.type === 'hidden.clearing' || message.type === 'hidden.refresh') {
    followIntent = false;
    jev.stop(t('clearJevStop'), true);
    monitor.credentialsChanged(available);
    hidden.refresh(message.type === 'hidden.clearing');
    status.textContent = t('clearCollectionStop');
  }
  if (message.type === 'confirmation.changed') {
    followIntent = false;
    monitor.stop(); jev.stop(t('confirmationRequired'), true);
    status.textContent = t('agreementChanged');
  }
  if (message.type === 'youtube.credentialsChanged' && 'available' in message && typeof message.available === 'boolean') {
    followIntent = false;
    jev.stop(t('youtubeKeyJevStop'), true);
    initializationGeneration++;
    available = message.available;
    monitor.credentialsChanged(available);
    status.textContent = t(available ? 'youtubeKeyChanged' : 'youtubeKeyMissingStop');
  }
  if (message.type === 'youtube.targetChanged') {
    followIntent = followIntent || monitor.isRunning();
    for (const row of retained) jev.remove(row.item);
    retained.length = 0;
    anchors = [];
    followLatest = true;
    hidden.setVideo(undefined);
    jev.resetTarget();
    validTarget = false;
    monitor.setVideo(undefined);
    start.disabled = true;
    target.textContent = t('targetChanged');
    void initializeTarget();
  }
  if (message.type === 'jev.credentialsChanged') jev.stop(t('jevKeyChanged'));
  return false;
});
async function initializeTarget() {
  const generation = ++initializationGeneration;
  try {
    const response = await runtime.sendMessage({ type: 'youtube.status' });
    if (generation !== initializationGeneration) return;
    if (typeof response === 'object' && response !== null && 'ok' in response && response.ok === false
      && 'error' in response && typeof response.error === 'object' && response.error !== null
      && 'code' in response.error && response.error.code === 'aborted'
      && 'targetChanged' in response.error && response.error.targetChanged === true) return;
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
    const resume = followIntent && !('paused' in response.value && response.value.paused === true);
    followIntent = false;
    if (resume) monitor.start(false);
    else { start.disabled = !available; stop.disabled = true; }
  } catch {
    if (generation !== initializationGeneration) return;
    followIntent = false; validTarget = false;
    monitor.setVideo(undefined); jev.resetTarget(); hidden.setVideo(undefined);
    start.disabled = true; stop.disabled = true;
    status.textContent = t('selectVideo');
  }
}
void initializeTarget();
