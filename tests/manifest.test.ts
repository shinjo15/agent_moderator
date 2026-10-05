import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MV3基盤', () => {
  it('設定・popup・service worker・YouTubeチャット専用入口を宣言する', () => {
    expect(existsSync('public/manifest.json')).toBe(true);
    const manifest = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.options_ui).toEqual({ page: 'options.html', open_in_tab: true });
    expect(manifest.action.default_popup).toBe('popup.html');
    expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' });
    expect(manifest.permissions).toEqual(['storage', 'activeTab']);
    expect(manifest.host_permissions).toEqual(['https://www.googleapis.com/*', 'https://api.typesafe.ai/*']);
    expect(manifest.content_scripts).toEqual([{
      matches: ['https://www.youtube.com/live_chat*', 'https://www.youtube.com/live_chat_replay*'],
      js: ['content.js'], all_frames: true, run_at: 'document_idle',
    }]);
    expect(manifest.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'");
  });
});
