import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

declare const chrome: {
  runtime: {
    sendMessage(message: unknown): Promise<unknown>;
    sendMessage(extensionId: string, message: unknown): Promise<unknown>;
  };
  storage: { local: {
    get(keys: string[] | null): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
  } };
};

async function launch(profile: string, companion?: string) {
  const extension = [resolve('dist'), ...(companion ? [companion] : [])].join(',');
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers().find(value => value.url().endsWith('/background.js')) ??
    await context.waitForEvent('serviceworker', { predicate: value => value.url().endsWith('/background.js') });
  return { context, worker, id: new URL(worker.url()).hostname };
}
async function withExtension(run: (context: BrowserContext, worker: Worker, id: string) => Promise<void>) {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-security-'));
  const { context, worker, id } = await launch(profile);
  try { await run(context, worker, id); }
  finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
}

for (const fails of [false, true]) {
  test(`初期storage.initの${fails ? '失敗' : '成功'}応答より先に入力した未送信キーを保持する`, async () => {
    await withExtension(async (context, worker, id) => {
      await worker.evaluate((fails) => {
        const originalGet = chrome.storage.local.get.bind(chrome.storage.local);
        let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        (globalThis as unknown as { releaseInitialRead: () => void }).releaseInitialRead = release;
        chrome.storage.local.get = async (keys) => {
          await gate;
          if (fails) throw new Error('synthetic-init-private-error');
          return originalGet(keys);
        };
      }, fails);
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/options.html`);
      await expect(page.getByTestId('youtube-status')).toHaveText('設定を確認中');
      await expect(page.getByRole('button', { name: 'YouTubeキーを保存' })).toBeDisabled();
      await page.getByLabel('Jev APIキー').fill('synthetic-initial-jev-draft');
      await page.getByLabel('YouTube APIキー').fill('synthetic-initial-youtube-draft');
      await worker.evaluate(() => (globalThis as unknown as { releaseInitialRead: () => void }).releaseInitialRead());
      await expect(page.getByRole('status')).toHaveText(fails ?
        'APIキーの設定に失敗しました。もう一度操作してください。保存する場合はキーを入力し直してください。' : 'APIキーの保存状況を確認しました。');
      await expect(page.getByLabel('Jev APIキー')).toHaveValue('synthetic-initial-jev-draft');
      await expect(page.getByLabel('YouTube APIキー')).toHaveValue('synthetic-initial-youtube-draft');
    });
  });
}

for (const operation of ['save', 'delete', 'failed-save'] as const) {
  test(`${operation}は対象providerだけをクリアし別providerの未送信入力を保持する`, async () => {
    await withExtension(async (context, worker, id) => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/options.html`);
      await expect(page.getByTestId('youtube-status')).toHaveText('未設定：設定が必要です。');
      if (operation === 'failed-save') {
        await worker.evaluate(() => {
          chrome.storage.local.set = async () => { throw new Error('synthetic-operation-private-error'); };
        });
      }
      for (const [name, other] of [['YouTube', 'Jev'], ['Jev', 'YouTube']]) {
        await page.getByLabel(`${name} APIキー`).fill('synthetic-operated-key');
        await page.getByLabel(`${other} APIキー`).fill('synthetic-unsubmitted-draft');
        await page.getByRole('button', { name: `${name}キーを${operation === 'delete' ? '削除' : '保存'}`, exact: true }).click();
        await expect(page.getByLabel(`${name} APIキー`)).toHaveValue('');
        await expect(page.getByLabel(`${other} APIキー`)).toHaveValue('synthetic-unsubmitted-draft');
        await expect(page.getByRole('status')).toHaveText(operation === 'failed-save' ?
          'APIキーの設定に失敗しました。もう一度操作してください。保存する場合はキーを入力し直してください。' : operation === 'save'
            ? 'APIキーの保存処理が完了しました。有効性は確認していません。' : 'APIキーの削除処理が完了しました。');
      }
    });
  });
}

test('実contentのisolated contextではlocal読取不可、init/設定/取得応答にキーなし', async () => {
  await withExtension(async (context, worker, id) => {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    await options.getByLabel('YouTube APIキー').fill('synthetic-content-protected');
    await options.getByRole('button', { name: 'YouTubeキーを保存' }).click();
    await expect(options.getByTestId('youtube-status')).toHaveText('設定済み');
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const worlds: { id: number; origin: string; auxData?: { type?: string } }[] = [];
    cdp.on('Runtime.executionContextCreated', event => worlds.push(event.context));
    await cdp.send('Runtime.enable');
    // Real matching URL and manifest content injection; no live YouTube/API traffic.
    await context.route('https://www.youtube.com/**', route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><html><body>Local chat fixture</body></html>',
    }));
    await page.goto('https://www.youtube.com/live_chat?v=synthetic');
    await expect.poll(() => worlds.some(world => world.origin === `chrome-extension://${id}` && world.auxData?.type === 'isolated')).toBe(true);
    const world = worlds.find(world => world.origin === `chrome-extension://${id}` && world.auxData?.type === 'isolated')!;
    const evaluated = await cdp.send('Runtime.evaluate', {
      contextId: world.id, awaitPromise: true, returnByValue: true,
      expression: `(async () => {
        let localDenied = false;
        try { await chrome.storage.local.get(null); } catch { localDenied = true; }
        const responses = [];
        for (const type of ['storage.init', 'credentials.get', 'credentials.save', 'credentials.delete']) {
          responses.push(await chrome.runtime.sendMessage({type, provider: 'youtube', value: 'synthetic-attacker'}));
        }
        return {localDenied, responses};
      })()`,
    });
    expect(evaluated.exceptionDetails).toBeUndefined();
    expect(evaluated.result.value).toEqual({
      localDenied: true,
      responses: Array.from({ length: 4 }, () => ({ ok: false, error: 'この要求は許可されていません。' })),
    });
    const jevDenied = await cdp.send('Runtime.evaluate', { contextId: world.id, awaitPromise: true, returnByValue: true,
      expression: `(async () => Promise.all(['jev.enable', 'jev.evaluate', 'jev.disable'].map(type => chrome.runtime.sendMessage({type, id: 'forged'}))))()` });
    expect(jevDenied.exceptionDetails).toBeUndefined();
    expect(jevDenied.result.value).toEqual(Array.from({ length: 3 }, () => ({ ok: false, error: { code: 'forbidden', message: 'このチャットを取得できません。視聴タブから対象を選び直してください。' } })));
    expect(await worker.evaluate(async () => (await chrome.storage.local.get(['apiKey.youtube']))['apiKey.youtube'] === 'synthetic-content-protected')).toBe(true);
    // The ordinary page world has no extension runtime / storage access.
    expect(await page.evaluate(() => {
      const value = (globalThis as unknown as { chrome?: { runtime?: { id?: string }; storage?: unknown } }).chrome;
      return Boolean(value?.runtime?.id || value?.storage);
    })).toBe(false);
  });
});

test('保存失敗時に固定文言だけ表示し入力・応答・ログへ秘密を残さない', async () => {
  await withExtension(async (context, worker, id) => {
    const page = await context.newPage();
    const logs: string[] = [];
    page.on('console', message => logs.push(message.text()));
    page.on('pageerror', error => logs.push(error.message));
    worker.on('console', message => logs.push(message.text()));
    await page.goto(`chrome-extension://${id}/options.html`);
    await expect(page.getByTestId('youtube-status')).toHaveText('未設定：設定が必要です。');
    await worker.evaluate(() => {
      chrome.storage.local.set = async () => { throw new Error('synthetic-error-containing-private-key'); };
    });
    await page.getByLabel('YouTube APIキー').fill('synthetic-error-containing-private-key');
    await page.getByRole('button', { name: 'YouTubeキーを保存' }).click();
    await expect(page.getByRole('status')).toHaveText('APIキーの設定に失敗しました。もう一度操作してください。保存する場合はキーを入力し直してください。');
    await expect(page.getByLabel('YouTube APIキー')).toHaveValue('');
    expect(await page.evaluate(() => chrome.runtime.sendMessage({ type: 'credentials.save', provider: 'youtube', value: 'synthetic-error-containing-private-key' }))).toEqual({ ok: false, error: 'キー設定の処理に失敗しました。再試行してください。' });
    expect(await page.locator('body').textContent()).not.toContain('synthetic-error-containing-private-key');
    expect(logs).toEqual([]);
    expect(await worker.evaluate(async () => !('apiKey.youtube' in await chrome.storage.local.get(null)))).toBe(true);
  });
});

test('ブラウザとservice workerを再起動してもキーを保持しUIには復元しない', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-restart-'));
  let launched = await launch(profile);
  try {
    const page = await launched.context.newPage();
    await page.goto(`chrome-extension://${launched.id}/options.html`);
    await page.getByLabel('YouTube APIキー').fill('synthetic-restart');
    await page.getByRole('button', { name: 'YouTubeキーを保存' }).click();
    await expect(page.getByTestId('youtube-status')).toHaveText('設定済み');
    await launched.context.close();
    launched = await launch(profile);
    const reopened = await launched.context.newPage();
    await reopened.goto(`chrome-extension://${launched.id}/options.html`);
    await expect(reopened.getByTestId('youtube-status')).toHaveText('設定済み');
    await expect(reopened.getByLabel('YouTube APIキー')).toHaveValue('');
    expect(await launched.worker.evaluate(async () => (await chrome.storage.local.get(['apiKey.youtube']))['apiKey.youtube'] === 'synthetic-restart')).toBe(true);
    await reopened.getByRole('button', { name: 'YouTubeキーを削除' }).click();
    await expect(reopened.getByTestId('youtube-status')).toHaveText('未設定：設定が必要です。');
  } finally { await launched.context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('別拡張機能の実external senderからキー操作・フィルター設定・全非表示削除を拒否する', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-external-profile-'));
  const companion = await mkdtemp(join(tmpdir(), 'agent-moderator-external-extension-'));
  await Promise.all([
    writeFile(join(companion, 'manifest.json'), JSON.stringify({
      manifest_version: 3, name: 'External sender test', version: '1.0',
      background: { service_worker: 'external-worker.js', type: 'module' },
    })),
    writeFile(join(companion, 'external-worker.js'), 'export {};'),
    writeFile(join(companion, 'external.html'), '<!doctype html><html><body>External sender fixture</body></html>'),
  ]);
  const { context, worker, id } = await launch(profile, companion);
  try {
    const options = await context.newPage();
    await options.goto(`chrome-extension://${id}/options.html`);
    await options.getByLabel('YouTube APIキー').fill('synthetic-external-protected');
    await options.getByRole('button', { name: 'YouTubeキーを保存' }).click();
    await expect(options.getByTestId('youtube-status')).toHaveText('設定済み');
    await options.getByLabel('フィルターの強さ', { exact: true }).selectOption('low');
    await options.getByRole('button', { name: 'フィルター設定を保存', exact: true }).click();
    await expect(options.getByTestId('filter-status')).toContainText('保存しました：低 / 判定の基準値 0.9');
    await expect.poll(() => context.serviceWorkers().some(value => value.url().endsWith('/external-worker.js'))).toBe(true);
    const externalWorker = context.serviceWorkers().find(value => value.url().endsWith('/external-worker.js'))!;
    const externalPage = await context.newPage();
    await externalPage.goto(`chrome-extension://${new URL(externalWorker.url()).hostname}/external.html`);
    for (const type of ['storage.init', 'credentials.get', 'credentials.save', 'credentials.delete', 'jev.enable', 'jev.evaluate', 'jev.disable']) {
      expect(await externalPage.evaluate(({ target, type }) => chrome.runtime.sendMessage(target, {
        type, provider: 'youtube', value: 'synthetic-attacker',
      }), { target: id, type })).toEqual({ ok: false, error: 'この要求は許可されていません。' });
    }
    for (const message of [{ type: 'settings.getFilter' }, { type: 'settings.saveFilter', threshold: 0.65 }]) {
      expect(await externalPage.evaluate(({ target, message }) => chrome.runtime.sendMessage(target, message), { target: id, message }))
        .toEqual({ ok: false, error: 'この要求は許可されていません。', code: 'authorization' });
    }
    expect(await externalPage.evaluate(target => chrome.runtime.sendMessage(target, { type: 'hidden.clearAll' }), id))
      .toEqual({ ok: false, error: 'この要求は許可されていません。' });
    expect(await options.evaluate(() => chrome.runtime.sendMessage({ type: 'settings.getFilter' }))).toEqual({ ok: true, value: { threshold: 0.9 } });
    expect(await worker.evaluate(async () => (await chrome.storage.local.get(['apiKey.youtube']))['apiKey.youtube'] === 'synthetic-external-protected')).toBe(true);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
    await rm(companion, { recursive: true, force: true });
  }
});
