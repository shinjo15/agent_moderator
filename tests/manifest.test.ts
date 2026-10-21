import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MV3基盤', () => {
  it('拡張専用入口とAPI権限だけを宣言しYouTubeへ注入しない', () => {
    expect(existsSync('public/manifest.json')).toBe(true);
    const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.options_ui).toEqual({ page: 'options.html', open_in_tab: true });
    expect(manifest.action.default_popup).toBe('popup.html');
    expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(manifest.permissions).toEqual(['storage', 'activeTab']);
    expect(manifest.host_permissions).toEqual(['https://www.googleapis.com/*', 'https://api.typesafe.ai/*']);
    expect(manifest.content_scripts).toBeUndefined();
    expect(manifest.web_accessible_resources).toBeUndefined();
    expect(manifest.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'");
  });
});
