import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('分離した入口だけを自己完結の配布物にビルドする', () => {
  expect(existsSync('scripts/build.mjs')).toBe(true);
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  expect(readdirSync('dist').sort()).toEqual([
    'background.js', 'content.js', 'manifest.json', 'options.html', 'options.js', 'popup.html', 'popup.js',
  ]);
  expect(JSON.parse(readFileSync('dist/manifest.json', 'utf8')))
    .toEqual(JSON.parse(readFileSync('public/manifest.json', 'utf8')));
  for (const file of ['options.html', 'popup.html']) {
    const html = readFileSync(`dist/${file}`, 'utf8');
    expect(html).toContain('lang="ja"');
    expect(html).toContain(`src="${file.replace('.html', '.js')}"`);
    expect(html).not.toMatch(/https?:|<script[^>]*>\s*[^\s<]/);
  }
});
