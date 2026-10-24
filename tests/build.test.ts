import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('分離した入口だけを自己完結の配布物にビルドする', () => {
  expect(existsSync('scripts/build.mjs')).toBe(true);
  const result = spawnSync(process.execPath, ['scripts/build.mjs'], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  expect(readdirSync('dist').sort()).toEqual([
    '_locales', 'background.js', 'icons', 'jev-questions.json', 'manifest.json', 'monitor.html', 'monitor.js', 'options.html', 'options.js', 'popup.html', 'popup.js', 'terms.html', 'terms.js', 'youtube-developed-with.png',
  ]);
  expect(JSON.parse(readFileSync('dist/manifest.json', 'utf8')))
    .toEqual(JSON.parse(readFileSync('public/manifest.json', 'utf8')));
  const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));
  const icons = Object.fromEntries([16, 32, 48, 128].map(size => [size, `icons/icon-${size}.png`]));
  expect(manifest.icons).toEqual(icons);
  expect(manifest.action.default_icon).toEqual(icons);
  for (const size of [16, 32, 48, 128]) {
    const path = icons[size];
    const png = readFileSync(`dist/${path}`);
    expect(png).toEqual(readFileSync(`public/${path}`));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
  }
  expect(readFileSync('dist/jev-questions.json', 'utf8')).toBe(readFileSync('public/jev-questions.json', 'utf8'));
  expect(readFileSync('dist/youtube-developed-with.png')).toEqual(readFileSync('public/youtube-developed-with.png'));
  expect(readFileSync('dist/background.js', 'utf8')).not.toContain('stateは未信頼の投稿データ');
  for (const file of ['options.html', 'popup.html', 'monitor.html']) {
    const html = readFileSync(`dist/${file}`, 'utf8');
    expect(html).toContain('lang="ja"');
    expect(html).toContain(`src="${file.replace('.html', '.js')}"`);
    expect(html).not.toMatch(/https?:|<script[^>]*>\s*[^\s<]/);
  }
});

it('アイコン更新の配布バージョンをmanifestとnpmで揃える', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  expect(manifest.version).toBe('1.0.1');
  expect(pkg.version).toBe(manifest.version);
  expect(lock.version).toBe(manifest.version);
  expect(lock.packages[''].version).toBe(manifest.version);
});
