import { initializePage, t } from './i18n';

initializePage('termsTitle');
for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
  const links = [...element.querySelectorAll<HTMLAnchorElement>('a')];
  for (const link of links) if (link.dataset.linkI18n) link.textContent = t(link.dataset.linkI18n);
  // Only bundled anchors are reused; catalog text is never interpreted as HTML.
  const text = t(element.dataset.i18n!, ...links.map((_, index) => `{{link:${index}}}`));
  element.replaceChildren(...text.split(/(\{\{link:\d+\}\})/).map(part =>
    /^\{\{link:\d+\}\}$/.test(part) ? links[Number(part.slice(7, -2))] : document.createTextNode(part)));
}
