// Shared presentation only: no state, storage, or moderation decisions.
export function createNotice(className: string, paragraphs: readonly string[], items: readonly string[] = []) {
  const notice = document.createElement('div'); notice.className = className;
  for (const text of paragraphs) {
    const paragraph = document.createElement('p'); paragraph.textContent = text; notice.append(paragraph);
  }
  if (items.length) {
    const list = document.createElement('ul');
    for (const text of items) { const item = document.createElement('li'); item.textContent = text; list.append(item); }
    notice.append(list);
  }
  return notice;
}
