import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('導入手順はJSON原本/実行時編集と反映・公開更新条件を明示する', () => {
  const text = readFileSync('docs/onboarding.md', 'utf8');
  for (const phrase of ['public/jev-questions.json', 'dist/jev-questions.json', '次の新規評価', '再ビルド不要', '上書き', '公開版', '拡張更新']) expect(text).toContain(phrase);
});
