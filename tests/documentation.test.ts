import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';

it('配信者scope・遅延移行・解除保護と版3再同意を日英UIと既存文書へ説明する', () => {
  for (const locale of ['ja', 'en']) {
    const messages = JSON.parse(readFileSync(`public/_locales/${locale}/messages.json`, 'utf8'));
    expect(messages.hiddenStorage.message).toContain(locale === 'ja' ? '配信者' : 'broadcaster');
    expect(messages.unhideNote.message).toContain(locale === 'ja' ? '別ライブ' : 'other live');
    expect(messages.termsFunction.message).toContain(locale === 'ja' ? '配信者' : 'broadcaster');
  }
  const privacy = readFileSync('docs/privacy.md', 'utf8');
  for (const token of ['hiddenAuthors.channel.', 'migratedVideos', '遅延移行', '版3', '旧形式']) expect(privacy).toContain(token);
  expect(readFileSync('docs/onboarding.md', 'utf8')).toContain('同じ配信者の別ライブ');
  expect(readFileSync('docs/terms.md', 'utf8')).toContain('配信者');
});

it('READMEから日本語導入手順へ辿れ、導入手順のローカルリンクが存在する', () => {
  const entry = 'docs/onboarding.md';
  expect(readFileSync('README.md', 'utf8')).toContain(`](${entry})`);
  expect(existsSync(entry)).toBe(true);
  const text = readFileSync(entry, 'utf8');
  expect(text).toContain('# 日本語導入手順');
  for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
    const target = match[1];
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('#')) continue;
    expect(existsSync(resolve(dirname(entry), target.split('#')[0])), target).toBe(true);
  }
});

it('導入手順からプライバシー説明と利用規約へ辿れる', () => {
  const text = readFileSync('docs/onboarding.md', 'utf8');
  for (const entry of ['privacy.md', 'terms.md']) {
    expect(text).toContain(`](${entry})`);
    expect(existsSync(`docs/${entry}`)).toBe(true);
  }
});

it('導入・削除手順は現行のUIと解除後の残存を案内する', () => {
  const onboarding = readFileSync('docs/onboarding.md', 'utf8');
  const privacy = readFileSync('docs/privacy.md', 'utf8');
  for (const text of [onboarding, privacy]) {
    expect(text).toContain('世代情報');
    expect(text).toContain('非表示を解除');
  }
  expect(onboarding).toContain('非表示一覧');
  expect(privacy).toContain('hiddenAuthors.');
});

it('実API・モデルの検証とfixtureを区別し、規約判断は保留する', () => {
  const readme = readFileSync('README.md', 'utf8');
  expect(readme).toContain('実YouTube Data API・実Jevへの接続');
  expect(readme).toContain('未検証');
  expect(readme).toContain('fixtureは実モデルの予測・精度測定ではありません');
  expect(readme).toContain('利用条件への適合・公開配布の承認は別途確認が必要');
});
