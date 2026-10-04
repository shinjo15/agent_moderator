import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';

// 明示allowlist: ソース、.env、ログ、秘密情報を梱包対象にしない。
const files = ['manifest.json', 'options.html', 'popup.html', 'monitor.html', 'options.js', 'popup.js', 'monitor.js', 'background.js', 'content.js'];
const archive = {};
for (const file of files) archive[file] = new Uint8Array(await readFile(`dist/${file}`));
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/agent-moderator.zip', zipSync(archive));
console.log('artifacts/agent-moderator.zip を作成しました');
