import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('案の同意導線と公開準備の記録を関連文書に整合させる', () => {
  expect(readFileSync('README.md', 'utf8')).toContain('](docs/terms.md)');
  for (const path of ['docs/onboarding.md', 'docs/privacy.md']) {
    const text = readFileSync(path, 'utf8');
    expect(text).toContain('](terms.md)');
    expect(text).toContain('同意を保存');
    expect(text).toContain('再同意');
    expect(text).not.toContain('利用条件・データの扱いを確認しました');
  }
  const audit = readFileSync('docs/release-preparation/privacy-readiness.md', 'utf8');
  for (const token of ['../terms.md', 'MetaMask', 'VERSION', 'terms.html', 'インストール前', '裁判', '現ストア']) expect(audit).toContain(token);
});

it('一般向け規約案とスクリプト不要の同梱HTMLは同じ本文・リンクを持つ', () => {
  expect(existsSync('docs/terms.md')).toBe(true);
  expect(existsSync('public/terms.html')).toBe(true);
  const markdown = readFileSync('docs/terms.md', 'utf8');
  const html = readFileSync('public/terms.html', 'utf8');
  const main = html.match(/<main>([\s\S]*?)<\/main>/)![1];
  const plain = (text: string) => text.replace(/\s+/g, '');
  expect(plain(main.replace(/<[^>]+>/g, ' '))).toBe(plain(markdown.replace(/^#+ /gm, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')));
  const markdownLinks = Array.from(markdown.matchAll(/\]\(([^)]+)\)/g), match => match[1]);
  const htmlLinks = Array.from(main.matchAll(/href="([^"]+)"/g), match => match[1]);
  expect(htmlLinks).toEqual(markdownLinks.map(href => href.startsWith('http') || href.startsWith('mailto:') ? href : `https://github.com/shinjo15/agent_moderator/blob/main/docs/${href}`));
  expect(html).toContain('lang="ja"');
  expect(html).toContain('charset="UTF-8"');
  expect(html).not.toMatch(/<script|\son\w+=|javascript:/i);
  for (const anchor of main.matchAll(/<a\b[^>]*>/g)) {
    expect(anchor[0]).toContain('target="_blank"');
    expect(anchor[0]).toContain('rel="noopener noreferrer"');
  }
  for (const token of ['施行日：未定', '正式施行ではありません', '個人', '本人', '利用者負担', '本人の画面', '誤判定', 'TypeSafe', '投稿者本人の同意', '全配信の非表示データを削除', '禁止事項', 'shinjo0015@gmail.com', '再同意', 'YouTube API Services']) expect(markdown).toContain(token);
  expect(markdown).not.toMatch(/## Sources|III\.E|裁判|準拠法|リバースエンジニア|0\.8|10秒|7項目|一切責任/);
  for (const match of markdown.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^[a-z][a-z\d+.-]*:/i.test(match[1])) continue;
    expect(existsSync(resolve(dirname('docs/terms.md'), match[1]))).toBe(true);
  }
});
