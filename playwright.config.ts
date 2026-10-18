import { defineConfig } from '@playwright/test';
// Existing Japanese acceptance tests launch their own persistent Chrome contexts.
// LANGUAGE controls Chrome's actual UI language on Linux, not only navigator.language.
process.env.LANGUAGE = 'ja';
process.env.LANG = 'ja_JP.UTF-8';
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1,
  timeout: 30_000, expect: { timeout: 5_000 },
  reporter: 'list', use: { trace: 'retain-on-failure', locale: 'ja-JP' },
});
