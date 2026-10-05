import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';

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

it('導入手順からプライバシー説明と公式規約の確認記録へ辿れる', () => {
  const text = readFileSync('docs/onboarding.md', 'utf8');
  for (const entry of ['privacy.md', 'policy-review.md']) {
    expect(text).toContain(`](${entry})`);
    expect(existsSync(`docs/${entry}`)).toBe(true);
  }
});

it('READMEからIssue #6の検証境界・未実施記録へ辿れる', () => {
  expect(readFileSync('README.md', 'utf8').includes('](docs/verification/issue-6.md)')).toBe(true);
  expect(existsSync('docs/verification/issue-6.md')).toBe(true);
});

it('#5統合後の導入・削除手順を実装済みのUIと保存契約として案内する', () => {
  const onboarding = readFileSync('docs/onboarding.md', 'utf8');
  const privacy = readFileSync('docs/privacy.md', 'utf8');
  for (const text of [onboarding, privacy]) {
    expect(text).toContain('](local-author-filter.md)');
    expect(text).toContain('revisions');
    expect(text).toContain('非表示を解除');
    expect(text).not.toMatch(/#5統合待ち|#5統合後|未統合の#5|現在のbaseはIssue #4まで/);
  }
  expect(onboarding).toContain('この配信の非表示投稿者');
  expect(onboarding).toContain('](verification/issue-5.md)');
  expect(onboarding).not.toContain('実DOM確認は未実施');
  expect(privacy).toContain('hiddenAuthors.');
});

it('#5の実測と#6統合検証へ辿れ、規約判断は保留する', () => {
  const readme = readFileSync('README.md', 'utf8');
  const policy = readFileSync('docs/policy-review.md', 'utf8');
  const verification = readFileSync('docs/verification/issue-6.md', 'utf8');
  expect(readme).toContain('](docs/local-author-filter.md)');
  expect(readme).toContain('](docs/verification/issue-5.md)');
  expect(readme).toContain('](docs/verification/issue-6.md)');
  expect(policy).toContain('](local-author-filter.md)');
  expect(policy).toContain('https://www.youtube.com/*');
  expect(policy).toContain('保留');
  expect(verification).toContain('](issue-5.md)');
  expect(verification).toContain('RED→GREEN');
  expect(verification).toContain('npm run package');
  expect(verification).not.toContain('#5親commit後の未達チェック');
});
