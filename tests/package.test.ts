import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import { expect, it } from 'vitest';

it('配布zipにはdistの検証済みファイルだけを含める', () => {
  expect(existsSync('scripts/package.mjs')).toBe(true);
  expect(spawnSync(process.execPath, ['scripts/build.mjs']).status).toBe(0);
  const result = spawnSync(process.execPath, ['scripts/package.mjs'], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  const archive = unzipSync(readFileSync('artifacts/agent-moderator.zip'));
  expect(Object.keys(archive).sort()).toEqual(readdirSync('dist').sort());
  for (const [name, bytes] of Object.entries(archive)) {
    expect(Buffer.from(bytes)).toEqual(readFileSync(`dist/${name}`));
  }
});
