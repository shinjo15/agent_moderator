// MAIN reads only renderer identity. No Chrome API, body collection or hidden list.
const selector = 'yt-live-chat-text-message-renderer,yt-live-chat-paid-message-renderer,yt-live-chat-paid-sticker-renderer,yt-live-chat-membership-item-renderer';
const seen = new WeakMap<Element, string>();
function publish(force = false) {
  for (const node of document.querySelectorAll(selector)) {
    const data = (node as Element & { data?: { id?: string; authorExternalChannelId?: unknown } }).data;
    const author = data?.authorExternalChannelId;
    const channelId = typeof author === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(author)
      && (!data?.id || data.id === node.id) ? author : null;
    const identity = JSON.stringify({ messageId: node.id, channelId });
    if (force || seen.get(node) !== identity) {
      seen.set(node, identity);
      node.dispatchEvent(new CustomEvent('agent-moderator.identity', { bubbles: true, detail: identity }));
    }
  }
}
document.addEventListener('agent-moderator.identify', () => publish(true));
new MutationObserver(() => publish()).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['id'] });
// Polymer data can change without an attribute/child mutation.
setInterval(() => publish(), 500);
