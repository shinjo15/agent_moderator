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
