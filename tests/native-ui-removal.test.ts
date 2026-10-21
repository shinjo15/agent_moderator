import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { expect, it } from 'vitest';

it('YouTube介入の旧ソース・動的注入・DOMブリッジを配布コードに残さない', () => {
  expect(existsSync('src/content.ts')).toBe(false);
  expect(existsSync('src/content-ids.ts')).toBe(false);
  for (const entry of readdirSync('src', { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())) {
    const path = `${entry.parentPath}/${entry.name}`;
    expect(readFileSync(path, 'utf8'), path).not.toMatch(/executeScript|insertCSS|registerContentScripts|chrome\.scripting|agent-moderator\.identit|authorExternalChannelId|yt-live-chat-\w+-renderer|MutationObserver/);
  }
  for (const path of ['scripts/build.mjs', 'scripts/package.mjs']) {
    expect(readFileSync(path, 'utf8'), path).not.toMatch(/content(?:-ids)?\.(?:ts|js)/);
  }
});

it('現行文書は保存管理と未実装#41を区別し旧版reloadを案内する', () => {
  for (const path of ['README.md', 'docs/privacy.md', 'docs/onboarding.md']) {
    const text = readFileSync(path, 'utf8');
    if (path === 'README.md') expect(text, path).toContain('#41');
    else expect(text, path).toContain('この版ではコメントの自動非表示は利用できません');
    expect(text, path).toContain('旧');
    expect(text, path).toContain('再読み込み');
    expect(text, path).not.toMatch(/contentの定期更新で|既存・新着非表示は続く|画面だけで非表示にします/);
  }
});

it('日英の説明は自動非表示を利用できず保存管理のみであることを明示する', () => {
  for (const locale of ['ja', 'en']) {
    const messages = JSON.parse(readFileSync(`public/_locales/${locale}/messages.json`, 'utf8'));
    for (const key of ['popupPersistence', 'hidingNotice', 'monitorClose', 'jevHiding', 'termsFunction']) {
      const text = messages[key].message;
      expect(text, `${locale}/${key}`).toContain(locale === 'ja' ? 'この版ではコメントの自動非表示は利用できません' : 'Automatic comment hiding is not available in this version');
      expect(text, `${locale}/${key}`).toContain(locale === 'ja' ? '保存' : 'saving');
      expect(text, `${locale}/${key}`).not.toMatch(/Issue|#\d+/);
    }
    const copy = Object.values(messages).map(value => (value as { message: string }).message).join('\n');
    expect(copy).not.toMatch(/画面だけで非表示にします|非表示は続き|Hiding continues|remain hidden|hide the relevant author's comments/);
  }
});
