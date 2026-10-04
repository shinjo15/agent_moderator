import { test, expect, chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';

test('実MV3内の独立coreをAPI fixtureで継続・重複・停止・固定エラー確認（実APIではない）', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-moderator-youtube-fixture-'));
  const extension = join(root, 'extension');
  await cp(resolve('dist'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  // Test-only trusted page。#2統合前のcoreをexerciseするためだけの追加で、dist/zipは変更しない。
  manifest.host_permissions = ['https://www.googleapis.com/*'];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(extension, 'fixture.html'), '<!doctype html><html lang="ja"><meta charset="utf-8"><title>API fixture (not live)</title><h1>API fixture（実APIではない）</h1><button id="start">開始</button><button id="stop">停止</button><p id="status"></p><ul id="messages"></ul><script src="fixture.js"></script></html>');
  await build({ entryPoints: ['e2e/fixtures/youtube-core-harness.ts'], outfile: join(extension, 'fixture.js'), bundle: true, format: 'iife', target: 'chrome120' });
  const context = await chromium.launchPersistentContext(join(root, 'profile'), {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const id = new URL(worker.url()).hostname;
    let videoCalls = 0;
    const tokens: (string | null)[] = [];
    let mode: 'success' | 'quota' | 'invalid' = 'success';
    await context.route('https://www.googleapis.com/youtube/v3/**', async route => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get('key')).toBe('fixture-not-a-real-api-key');
      if (url.pathname.endsWith('/videos')) {
        videoCalls++;
        await route.fulfill({ json: { items: [{ id: 'abcdefghijk', liveStreamingDetails: { activeLiveChatId: 'fixture-chat' } }] } });
        return;
      }
      tokens.push(url.searchParams.get('pageToken'));
      if (mode === 'quota') {
        await route.fulfill({ status: 403, json: { error: { message: 'private-provider-message https://private.invalid', errors: [{ reason: 'quotaExceeded' }] } } });
      } else if (mode === 'invalid') {
        await route.fulfill({ json: { items: [] } });
      } else {
        await route.fulfill({ json: { nextPageToken: `token-${tokens.length}`, pollingIntervalMillis: 8000,
          items: [1, tokens.length].map(index => ({ id: `fixture-message-${index}`, snippet: { type: 'textMessageEvent', hasDisplayContent: true, displayMessage: '<script>fixture</script>' }, authorDetails: { channelId: 'fixture-channel' } })) } });
      }
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.goto(`chrome-extension://${id}/fixture.html`);
    await page.clock.pauseAt(new Date('2026-01-01T00:00:10Z'));
    await page.getByRole('button', { name: '開始' }).click();
    await page.clock.runFor(1);
    await expect.poll(() => videoCalls).toBe(1);
    await page.clock.runFor(5000);
    await expect(page.locator('#messages li')).toHaveCount(1);
    expect(tokens).toEqual([null]);
    await page.clock.runFor(7999);
    expect(tokens).toHaveLength(1);
    await page.clock.runFor(1);
    await expect(page.locator('#messages li')).toHaveCount(2);
    expect(tokens).toEqual([null, 'token-1']);
    await expect(page.locator('#messages')).toContainText('<script>fixture</script>');
    await expect(page.locator('#messages script')).toHaveCount(0);
    await page.getByRole('button', { name: '停止' }).click();
    await expect(page.locator('#status')).toHaveText('stopped');
    await page.clock.runFor(60000);
    expect(tokens).toHaveLength(2);
    mode = 'quota';
    await page.getByRole('button', { name: '開始' }).click();
    await page.clock.runFor(1);
    await expect(page.locator('#status')).toContainText('error: quota:');
    await expect(page.locator('#status')).not.toContainText('private');
    await page.clock.runFor(60000);
    expect(tokens).toHaveLength(3);
    mode = 'invalid';
    await page.getByRole('button', { name: '開始' }).click();
    await page.clock.runFor(1);
    await expect(page.locator('#status')).toContainText('error: invalidResponse:');
    await page.clock.runFor(60000);
    expect(tokens).toHaveLength(4);
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
    await rm(root, { recursive: true, force: true });
  }
});
