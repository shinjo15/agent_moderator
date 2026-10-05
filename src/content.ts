import { runtime } from './extension-runtime';
import { chatVideo } from './hidden-authors/handler';
import { validAuthor } from './hidden-authors/store';
const selector = 'yt-live-chat-text-message-renderer,yt-live-chat-paid-message-renderer,yt-live-chat-paid-sticker-renderer,yt-live-chat-membership-item-renderer';
const identity = new WeakMap<Element, { messageId: string; channelId: string | null }>();
const previous = new WeakMap<HTMLElement, { value: string; priority: string }>();
let ids = new Set<string>();
let listVideo: string | undefined;
let refreshGeneration = 0;
function apply(node: HTMLElement) {
  const record = identity.get(node);
  const hide = listVideo !== undefined && listVideo === chatVideo(location.href, document.referrer)
    && record?.messageId === node.id && record.channelId !== null && ids.has(record.channelId);
  if (hide) {
    if (!previous.has(node)) previous.set(node, { value: node.style.getPropertyValue('display'), priority: node.style.getPropertyPriority('display') });
    node.style.setProperty('display', 'none', 'important');
  } else {
    const saved = previous.get(node);
    if (saved) { node.style.setProperty('display', saved.value, saved.priority); previous.delete(node); }
  }
}
function applyAll() { for (const node of document.querySelectorAll<HTMLElement>(selector)) apply(node); }
document.addEventListener('agent-moderator.identity', event => {
  const node = event.target;
  const detail = (event as CustomEvent<unknown>).detail;
  if (!(node instanceof HTMLElement) || !node.matches(selector) || typeof detail !== 'string' || detail.length > 1000) return;
  try {
    const record = JSON.parse(detail) as { messageId?: unknown; channelId?: unknown };
    if (record.messageId !== node.id || (record.channelId !== null && !validAuthor(record.channelId))) return;
    identity.set(node, { messageId: node.id, channelId: record.channelId }); apply(node);
  } catch { /* Unidentified renderer remains visible. */ }
});
async function refresh() {
  const generation = ++refreshGeneration;
  const videoId = chatVideo(location.href, document.referrer);
  if (videoId !== listVideo) { ids.clear(); listVideo = videoId; applyAll(); }
  if (!videoId) { ids.clear(); applyAll(); return; }
  try {
    const reply = await runtime.sendMessage({ type: 'hidden.list', videoId, referrer: document.referrer }) as { ok?: boolean; videoId?: string; ids?: unknown };
    if (generation !== refreshGeneration || videoId !== chatVideo(location.href, document.referrer)) return;
    ids = reply.ok === true && reply.videoId === videoId && Array.isArray(reply.ids) ? new Set(reply.ids.filter(validAuthor)) : new Set();
  } catch { if (generation !== refreshGeneration) return; /* Keep the last valid list during worker restart. */ }
  document.dispatchEvent(new Event('agent-moderator.identify')); applyAll();
}
new MutationObserver(() => applyAll()).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['id'] });
void refresh();
setInterval(() => { void refresh(); }, 1000);
