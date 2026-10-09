import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { mkdtemp, rm, cp, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
declare const chrome: { storage: { local: { set(values: Record<string, unknown>): Promise<void> } }; action: { openPopup(): Promise<void> }; runtime: {
  getURL(path: string): string;
  sendMessage(message: unknown): Promise<unknown>;
  getContexts(filter: object): Promise<unknown[]>;
  onMessage: { addListener(listener: (message: { type?: string }, sender: {
    id?: string; url?: string; origin?: string; documentId?: string; documentLifecycle?: string; frameId?: number;
  }, reply: (response: unknown) => void) => boolean): void };
} };

async function popup(context: BrowserContext, selectedWorker?: Worker) {
  const worker = selectedWorker ?? context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).hostname;
  await worker.evaluate(() => {
    const records: unknown[] = [];
    Object.assign(globalThis, { popupSenderEvidence: records });
    chrome.runtime.onMessage.addListener((message, sender) => {
      if (['settings.getFilter', 'settings.saveFilter', 'storage.init', 'credentials.get'].includes(message.type ?? '')) {
        const { id, url, origin, documentId, documentLifecycle, frameId } = sender;
        records.push({ type: message.type, id, url, origin, documentId, documentLifecycle, frameId });
      }
      return false;
    });
  });
  await worker.evaluate(() => chrome.action.openPopup());
  const cdp = await context.browser()!.newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets');
  const target = targetInfos.find(value => value.url === `chrome-extension://${id}/popup.html`)!;
  expect(target).toBeDefined();
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
  let sequence = 0;
  async function evaluate(expression: string): Promise<unknown> {
    const requestId = ++sequence;
    const response = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { cdp.off('Target.receivedMessageFromTarget', receive); reject(new Error('popup CDP timeout')); }, 5000);
      const receive = (event: { sessionId: string; message: string }) => {
        const message = JSON.parse(event.message);
        if (event.sessionId !== sessionId || message.id !== requestId) return;
        clearTimeout(timer); cdp.off('Target.receivedMessageFromTarget', receive);
        if (message.error || message.result.exceptionDetails) reject(new Error('popup CDP evaluation failed'));
        else resolve(message.result.result.value);
      };
      cdp.on('Target.receivedMessageFromTarget', receive);
    });
    await cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: requestId, method: 'Runtime.evaluate', params: {
      expression, awaitPromise: true, returnByValue: true,
    } }) });
    return response;
  }
  expect(await evaluate("chrome.extension.getViews({type:'popup'}).includes(window)")).toBe(true);
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='設定を開く').click()");
  await expect.poll(() => evaluate('location.pathname')).toBe('/options.html');
  await expect.poll(() => evaluate("document.querySelector('select')?.disabled")).toBe(false);
  return { worker, evaluate };
}

async function launch(profile: string, extensions = resolve('dist')) {
  return chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, viewport: null,
    args: [`--disable-extensions-except=${extensions}`, `--load-extension=${extensions}`] });
}

async function legacyExtension(path: string) {
  await cp(resolve('dist'), path, { recursive: true });
  // Fixed byte-identical historical dispatcher: no mutable Git HEAD dependency in CI.
  // Current imports deliberately isolate the old dispatch schema, not an entire old release.
  await build({ stdin: { contents: await readFile(resolve('e2e/fixtures/legacy-background-source.txt'), 'utf8'), resolveDir: resolve('src'), loader: 'ts' },
    outfile: join(path, 'background.js'), bundle: true, format: 'iife', target: 'chrome120', logLevel: 'silent' });
}

test('実monitorを同時openしたactual popup保存: 非async false listenerとbackgroundは競合しない', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-monitor-popup-'));
  const context = await launch(profile);
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const monitor = await context.newPage();
    await monitor.addInitScript(() => {
      const probe = { registered: false, synchronousFalse: [] as boolean[] };
      Object.assign(globalThis, { monitorListenerProbe: probe });
      const add = chrome.runtime.onMessage.addListener.bind(chrome.runtime.onMessage);
      chrome.runtime.onMessage.addListener = listener => {
        probe.registered = true;
        add((message, sender, reply) => {
          const returned = listener(message, sender, reply);
          if (message.type === 'settings.getFilter' || message.type === 'settings.saveFilter') probe.synchronousFalse.push(returned === false);
          return returned;
        });
      };
    });
    await monitor.goto(`chrome-extension://${new URL(worker.url()).hostname}/monitor.html`);
    await expect.poll(() => monitor.evaluate(() => (globalThis as typeof globalThis & { monitorListenerProbe: { registered: boolean } }).monitorListenerProbe.registered)).toBe(true);
    const active = await popup(context);
    expect(await active.evaluate("document.querySelector('[data-testid=filter-status]').textContent.startsWith('現在の設定：')")).toBe(true);
    for (const [choice, threshold] of [['medium', 0.8], ['high', 0.65], ['low', 0.9]] as const) {
      await active.evaluate(`document.querySelector('select').value=${JSON.stringify(choice)}; document.querySelector('select').dispatchEvent(new Event('change')); document.querySelector('.filter-card button').click()`);
      await expect.poll(() => active.evaluate("document.querySelector('[data-testid=filter-status]').textContent.startsWith('保存しました：')")).toBe(true);
      expect(await active.evaluate(`(async()=>{const r=await chrome.runtime.sendMessage({type:'settings.getFilter'});return r?.ok===true&&r.value?.threshold===${threshold}})()`)).toBe(true);
    }
    const returns = await monitor.evaluate(() => (globalThis as typeof globalThis & { monitorListenerProbe: { synchronousFalse: boolean[] } }).monitorListenerProbe.synchronousFalse);
    expect(returns.length).toBeGreaterThan(0); expect(returns.every(value => value)).toBe(true);
    console.log('SAFE_MONITOR_POPUP_FLAGS', JSON.stringify({ browser: context.browser()!.version(), monitorSawSettings: returns.length > 0, allSynchronousFalse: returns.every(value => value), allSavesSucceeded: true }));
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('新旧backgroundの2コピー同時load: getURL一致でも旧dispatchだけlegacy拒否となる', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-moderator-two-copies-'));
  const current = join(root, 'current'); const legacy = join(root, 'legacy');
  await cp(resolve('dist'), current, { recursive: true }); await legacyExtension(legacy);
  const context = await launch(join(root, 'profile'), `${current},${legacy}`);
  try {
    await expect.poll(() => context.serviceWorkers().length).toBe(2);
    const workers = context.serviceWorkers();
    const results = [];
    for (const worker of workers) {
      // Headless action.openPopup with two loaded copies failed before request dispatch.
      // Use native options documents for this isolation probe; actual popup has separate coverage.
      const page = await context.newPage();
      await page.goto(`chrome-extension://${new URL(worker.url()).hostname}/options.html`);
      await expect(page.getByRole('button', { name: 'フィルター設定を保存', exact: true })).toBeEnabled();
      const active = { evaluate: (expression: string) => page.evaluate(expression) };
      const initialSucceeded = await active.evaluate("document.querySelector('[data-testid=filter-status]').textContent.startsWith('現在の設定：')");
      const runtimeUrlMatches = await active.evaluate("location.href===chrome.runtime.getURL('options.html')");
      await active.evaluate("document.querySelector('select').value='medium'; document.querySelector('select').dispatchEvent(new Event('change')); document.querySelector('.filter-card button').click()");
      await expect.poll(() => active.evaluate("document.querySelector('.filter-card button').disabled")).toBe(false);
      results.push({ initialSucceeded, runtimeUrlMatches,
        saved: await active.evaluate("document.querySelector('[data-testid=filter-status]').textContent.startsWith('保存しました：')"),
        legacyDenied: await active.evaluate("document.querySelector('[data-testid=filter-status]').textContent.includes('filter-save-responseDeniedLegacy')") });
    }
    expect(results.every(result => result.runtimeUrlMatches)).toBe(true);
    expect(results.filter(result => result.saved && result.initialSucceeded).length).toBe(1);
    expect(results.filter(result => result.legacyDenied && !result.initialSucceeded).length).toBe(1);
    console.log('SAFE_DUPLICATE_FLAGS', JSON.stringify({ distinctIds: new Set(workers.map(worker => new URL(worker.url()).hostname)).size === 2, results }));
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); }
});

test('旧dispatch＋新optionsのactual popupは初期getも中0.8保存もlegacy固定codeとなる', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-moderator-legacy-popup-'));
  const extension = join(root, 'extension');
  await legacyExtension(extension);
  const context = await launch(join(root, 'profile'), extension);
  try {
    const active = await popup(context);
    expect(await active.evaluate("document.querySelector('[data-testid=filter-status]').textContent.includes('filter-initialGet-responseDeniedLegacy shape:101000')")).toBe(true);
    expect(await active.evaluate("location.href===chrome.runtime.getURL('options.html')")).toBe(true);
    await active.evaluate("document.querySelector('select').value='medium'; document.querySelector('select').dispatchEvent(new Event('change')); document.querySelector('.filter-card button').click()");
    await expect.poll(() => active.evaluate("document.querySelector('[data-testid=filter-status]').textContent.includes('filter-save-responseDeniedLegacy shape:101000')")).toBe(true);
  } finally { await context.close(); await rm(root, { recursive: true, force: true }); }
});

test('actual popup query付きoptionsはauthorization拒否で、inconsistentResponseではない', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-popup-query-'));
  const context = await launch(profile);
  try {
    const active = await popup(context);
    await active.evaluate("location.search='?source=synthetic'");
    await expect.poll(() => active.evaluate("document.querySelector('select')?.disabled")).toBe(false);
    expect(await active.evaluate("location.href===chrome.runtime.getURL('options.html')")).toBe(false);
    await active.evaluate("document.querySelector('.filter-card button').click()");
    await expect.poll(() => active.evaluate("document.querySelector('[data-testid=filter-status]').textContent.includes('filter-save-authorization')")).toBe(true);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('monitor側の故意のreply(false)は実Chromeで先に採用され、safe形状codeで特定できる', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-competition-control-'));
  const context = await launch(profile);
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const monitor = await context.newPage();
    await monitor.goto(`chrome-extension://${new URL(worker.url()).hostname}/monitor.html`);
    await monitor.evaluate(() => {
      chrome.runtime.onMessage.addListener((message, _sender, reply) => {
        if (message.type === 'settings.saveFilter') reply(false);
        return false;
      });
    });
    await worker.evaluate(() => {
      const set = chrome.storage.local.set.bind(chrome.storage.local);
      chrome.storage.local.set = async values => { if ('moderation.threshold' in values) await new Promise(resolve => setTimeout(resolve, 100)); return set(values); };
    });
    const active = await popup(context);
    await active.evaluate("document.querySelector('.filter-card button').click()");
    await expect.poll(() => active.evaluate("document.querySelector('.filter-card button').disabled")).toBe(false);
    console.log('SAFE_COMPETITION_FLAGS', JSON.stringify(await active.evaluate("(()=>{const text=document.querySelector('[data-testid=filter-status]').textContent;return {oldInconsistent:text.includes('filter-save-inconsistentResponse'),invalidShape:text.includes('filter-save-invalidShape'),saved:text.startsWith('保存しました：')}})()")));
    await expect.poll(() => active.evaluate("document.querySelector('[data-testid=filter-status]').textContent.includes('filter-save-invalidShape')")).toBe(true);
    expect(await active.evaluate("document.querySelector('[data-testid=filter-status]').textContent.includes('shape:000000')")).toBe(true);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});

test('actual action popup→同じpopup内optionsの保存は拒否されずreadbackする', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-popup-save-'));
  let context = await launch(profile);
  try {
    const { worker, evaluate } = await popup(context);
    await evaluate("document.querySelector('select').value='high'; document.querySelector('select').dispatchEvent(new Event('change')); document.querySelector('.filter-card button').click()");
    await expect.poll(() => evaluate("document.querySelector('.filter-card button').disabled")).toBe(false);
    const diagnostics = await evaluate("(async()=>{const get=await chrome.runtime.sendMessage({type:'settings.getFilter'}),save=await chrome.runtime.sendMessage({type:'settings.saveFilter',threshold:0.65}),credentials=await chrome.runtime.sendMessage({type:'storage.init'}),secret=await chrome.runtime.sendMessage({type:'credentials.get',provider:'jev'});return {isPopup:chrome.extension.getViews({type:'popup'}).includes(window),documentUrlMatches:location.href===chrome.runtime.getURL('options.html'),uiSaved:document.querySelector('[data-testid=filter-status]').textContent==='保存しました：高 / 判定の基準値 0.65',getValid:get?.ok===true&&get.value?.threshold===0.65,saveValid:save?.ok===true&&save.value?.threshold===0.65,credentialsValid:credentials?.ok===true&&credentials.status?.jev===false&&credentials.status?.youtube===false,secretDenied:secret?.ok===false}})()");
    const metadataMatches = await worker.evaluate(() => {
      const records = (globalThis as typeof globalThis & { popupSenderEvidence: { url?: string }[] }).popupSenderEvidence;
      return records.length > 0 && records.every(record => record.url === chrome.runtime.getURL('options.html'));
    });
    const popupContextMatches = await worker.evaluate(async () => (await chrome.runtime.getContexts({}) as { contextType?: string; documentUrl?: string }[])
      .some(context => context.contextType === 'POPUP' && context.documentUrl === chrome.runtime.getURL('options.html')));
    console.log('SAFE_POPUP_FLAGS', JSON.stringify({ browser: context.browser()!.version(), diagnostics, metadataMatches, popupContextMatches }));
    expect(diagnostics).toEqual({ isPopup: true, documentUrlMatches: true, uiSaved: true, getValid: true, saveValid: true, credentialsValid: true, secretDenied: true });
    expect(metadataMatches).toBe(true); expect(popupContextMatches).toBe(true);
    expect(await evaluate("chrome.runtime.sendMessage({type:'confirmation.get'})")).toEqual({ ok: true, value: { confirmed: false, version: 2 } });
    await evaluate("document.querySelector('input[type=checkbox]').click(); Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='同意を保存').click()");
    await expect.poll(() => evaluate("document.querySelector('[data-testid=confirmation-status]').textContent")).toContain('同意済み');
    expect(await evaluate("chrome.runtime.sendMessage({type:'confirmation.get'})")).toEqual({ ok: true, value: { confirmed: true, version: 2 } });
    for (const [choice, threshold] of [['high', 0.65], ['medium', 0.8], ['low', 0.9], ['custom', 0], ['custom', 1], ['custom', 0.731]] as const) {
      await evaluate(`document.querySelector('select').value=${JSON.stringify(choice)}; document.querySelector('select').dispatchEvent(new Event('change'));
        ${choice === 'custom' ? `document.querySelector('#filter-threshold').value=${JSON.stringify(String(threshold))}; document.querySelector('#filter-threshold').dispatchEvent(new Event('input'));` : ''}
        document.querySelector('.filter-card button').click()`);
      await expect.poll(() => evaluate("document.querySelector('[data-testid=filter-status]').textContent")).toContain(`判定の基準値 ${threshold}`);
      await expect.poll(() => evaluate("document.querySelector('.filter-card button').disabled")).toBe(false);
      expect(await evaluate("document.querySelector('[data-testid=filter-status]').textContent")).toMatch(/^保存しました：/);
      expect(await evaluate("chrome.runtime.sendMessage({type:'settings.getFilter'})")).toEqual({ ok: true, value: { threshold } });
    }
    // Same sender boundary as credentials: only synthetic data, never retrieve stored keys.
    expect(await evaluate("chrome.runtime.sendMessage({type:'credentials.save',provider:'jev',value:'synthetic-popup-only'})")).toEqual({ ok: true, status: { jev: true, youtube: false } });
    expect(await evaluate("chrome.runtime.sendMessage({type:'storage.init'})")).toEqual({ ok: true, status: { jev: true, youtube: false } });
    expect(await evaluate("chrome.runtime.sendMessage({type:'credentials.get',provider:'jev'})")).toEqual({ ok: false, error: 'この要求は許可されていません。' });
    for (const request of [{ type: 'settings.saveFilter', threshold: '0.8' }, { type: 'settings.saveFilter', threshold: 2 },
      { type: 'settings.saveFilter', threshold: 0.65, extra: true }]) {
      expect(await evaluate(`chrome.runtime.sendMessage(${JSON.stringify(request)})`)).toMatchObject({ ok: false });
    }
    expect(await evaluate("chrome.runtime.sendMessage({type:'settings.getFilter'})")).toEqual({ ok: true, value: { threshold: 0.731 } });
    await context.close(); context = await launch(profile);
    const restarted = await popup(context);
    await expect.poll(() => restarted.evaluate("document.querySelector('[data-testid=confirmation-status]').textContent")).toContain('同意済み');
    await expect.poll(() => restarted.evaluate("document.querySelector('[data-testid=filter-status]').textContent")).toBe('現在の設定：カスタム / 判定の基準値 0.731');
    expect(await restarted.evaluate("chrome.runtime.sendMessage({type:'settings.getFilter'})")).toEqual({ ok: true, value: { threshold: 0.731 } });
    expect(await restarted.evaluate("chrome.runtime.sendMessage({type:'storage.init'})")).toEqual({ ok: true, status: { jev: true, youtube: false } });
    expect(await restarted.evaluate("document.querySelector('#jev-key').value")).toBe('');
    expect(await restarted.evaluate("chrome.runtime.sendMessage({type:'credentials.get',provider:'jev'})")).toMatchObject({ ok: false });
    await restarted.worker.evaluate(() => {
      const original = chrome.storage.local.set.bind(chrome.storage.local);
      chrome.storage.local.set = async values => {
        if ('moderation.threshold' in values) throw new Error('synthetic-private-storage-value');
        return original(values);
      };
    });
    await restarted.evaluate("document.querySelector('select').value='medium'; document.querySelector('select').dispatchEvent(new Event('change')); document.querySelector('.filter-card button').click()");
    await expect.poll(() => restarted.evaluate("document.querySelector('[data-testid=filter-status]').textContent")).toBe('フィルター設定の処理に失敗しました。保存状態を確認できません。もう一度保存してください。 確認コード: filter-save-write');
    expect(await restarted.evaluate("document.body.textContent.includes('synthetic-private-storage-value')")).toBe(false);
    expect(await restarted.evaluate("chrome.runtime.sendMessage({type:'settings.getFilter'})")).toEqual({ ok: true, value: { threshold: 0.731 } });
    expect(await restarted.evaluate("chrome.runtime.sendMessage({type:'storage.init'})")).toEqual({ ok: true, status: { jev: true, youtube: false } });
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
});
