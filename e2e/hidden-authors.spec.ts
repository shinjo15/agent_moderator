import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { apiResponse } from '../tests/fixtures/jev';
import { confirmUsage } from './fixtures/confirm-usage';
import { CONFIRMATION_VERSION } from '../src/confirmation';
declare const chrome: { tabs: { create(o: {url:string;active:boolean}):Promise<unknown>;getCurrent():Promise<{id?:number}> }; runtime:{sendMessage(m:unknown):Promise<unknown>}; storage:{local:{get(keys:string[] | null):Promise<Record<string,unknown>>;set(v:Record<string,unknown>):Promise<void>};session:{get(keys:string[]):Promise<Record<string,unknown>>;set(v:Record<string,unknown>):Promise<void>}} };
const author = 'UCabcdefghijklmnopqrstuv'; const video = 'abcdefghijk';
const broadcaster = 'UC0000000000000000000000';

test('MV3: 公式取得fixture→Jev判定→保存一覧・解除・連投の再登録・全削除',async()=>{
 test.setTimeout(90000);
 const profile=await mkdtemp(join(tmpdir(),'agent-moderator-hidden-'));
 const extension=resolve('dist');
 const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:['--enable-unsafe-extension-debugging',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 try{
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=new URL(worker.url()).hostname;
 await context.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><h1>視聴タブfixture</h1>'}));
 let pages=0; let burst=false; let fail=false;
 await context.route('https://www.googleapis.com/youtube/v3/**',route=>{
 const url=new URL(route.request().url());
 if (fail && !url.pathname.endsWith('/videos')) return route.fulfill({status:503,body:'fixture-unavailable'});
 if (burst && !url.pathname.endsWith('/videos')) return route.fulfill({json:{nextPageToken:`burst-${++pages}`,pollingIntervalMillis:5000,items:Array.from({length:10},(_,n)=>({id:`burst-${pages}-${n}`,snippet:{type:'textMessageEvent',hasDisplayContent:true,displayMessage:'公式取得fixtureの連投',publishedAt:new Date(Date.UTC(2026,0,1,0,1,n)).toISOString()},authorDetails:{channelId:author,displayName:'みどり'}}))}});
 return route.fulfill({json:url.pathname.endsWith('/videos')?{items:[{id:video,snippet:{channelId:broadcaster},liveStreamingDetails:{activeLiveChatId:'fixture-chat'}}]}:{nextPageToken:`next-${++pages}`,pollingIntervalMillis:5000,items:[{id:`post-${pages}`,snippet:{type:'textMessageEvent',hasDisplayContent:true,displayMessage:'APIからだけの本文',publishedAt:new Date(2026,0,1,0,0,pages*5).toISOString()},authorDetails:{channelId:author,displayName:'みどり'}}]}});
 });
 let releaseJev: (() => void) | undefined;
 await context.route('https://api.typesafe.ai/v1/systemone',async route=>{
 expect(JSON.stringify(route.request().postDataJSON().state)).not.toContain('みどり');
 if (!releaseJev) await new Promise<void>(done => { releaseJev = done; });
 await route.fulfill({json:apiResponse({attack:0.8})});
 });
 const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
 await confirmUsage(options);
 for(const p of ['YouTube','Jev']){await options.getByLabel(`${p} APIキー`).fill(`synthetic-${p}`);await options.getByRole('button',{name:`${p}キーを保存`,exact:true}).click();await expect(options.getByLabel(`${p} APIキー`)).toHaveValue('');}
 const youtube=await context.newPage();await youtube.goto(`https://www.youtube.com/watch?v=${video}`);await youtube.bringToFront();
 const cdp=await context.browser()!.newBrowserCDPSession();const {targetInfos}=await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]});
 await cdp.send('Extensions.triggerAction',{id,targetId:targetInfos.find(t=>t.type==='tab'&&t.url===youtube.url())!.targetId});
 const pp=context.waitForEvent('page');await worker.evaluate(id=>chrome.tabs.create({url:`chrome-extension://${id}/popup.html`,active:false}),id);const popup=await pp;
 const mp=context.waitForEvent('page');await popup.getByRole('button',{name:'この動画のチャットを取得'}).click();const monitor=await mp;
 await expect(monitor.getByRole('button',{name:'取得を開始',exact:true})).toBeEnabled();
 await monitor.getByRole('button',{name:'Jev判定を有効化・再開'}).click();await expect(monitor.getByTestId('jev-status')).toContainText('有効');
 await monitor.getByRole('button',{name:'取得を開始',exact:true}).click();
 await expect.poll(()=>typeof releaseJev,{timeout:15000}).toBe('function');
 await expect(monitor.locator('#hidden-authors li')).toHaveCount(0);
 releaseJev!();
 await expect(monitor.locator('#hidden-authors li')).toContainText(author,{timeout:15000});
 await expect(monitor.locator('#hidden-authors .hidden-trigger-text')).toHaveText('APIからだけの本文');
 await expect(monitor.locator('.hidden-count-badge')).toHaveText('1');
 await expect(monitor.locator('#messages li')).toHaveCount(0);
 await expect(monitor.locator('#messages')).not.toContainText('APIからだけの本文');
 await expect(monitor.locator('.chat-scroll .empty-list')).toContainText('非表示');

 expect(await worker.evaluate(async broadcaster => (await chrome.storage.local.get([`hiddenAuthors.channel.${broadcaster}`]))[`hiddenAuthors.channel.${broadcaster}`], broadcaster))
   .toMatchObject({ ids: [author], displayNames: { [author]: 'みどり' }, triggerComments: { [author]: { text: 'APIからだけの本文', videoId: video } } });
 await monitor.getByRole('button',{name:'取得を停止',exact:true}).click();
 await monitor.reload();
 await expect(monitor.locator('#hidden-authors .hidden-trigger-text')).toHaveText('APIからだけの本文');
 await expect(monitor.getByTestId('jev-status')).toContainText('未有効化');
 await monitor.waitForTimeout(5100); // Reload does not shorten the background API cooldown.
 const beforeReload = pages;
 await monitor.evaluate(() => {
   Object.assign(globalThis, { savedAuthorFlashed: false });
   const check = () => { if (document.querySelector('#messages li')) Object.assign(globalThis, { savedAuthorFlashed: true }); requestAnimationFrame(check); };
   requestAnimationFrame(check);
 });
 await monitor.getByRole('button',{name:'取得を開始',exact:true}).click();
 await expect.poll(() => pages, { timeout: 15000 }).toBeGreaterThan(beforeReload);
 await monitor.waitForTimeout(100);
 await expect(monitor.locator('#messages li')).toHaveCount(0);
 expect(await monitor.evaluate(() => (globalThis as typeof globalThis & { savedAuthorFlashed: boolean }).savedAuthorFlashed)).toBe(false);
 await monitor.getByRole('button',{name:'取得を停止',exact:true}).click();
 await monitor.getByRole('button',{name:'非表示一覧',exact:true}).click();
 await monitor.getByRole('button',{name:`みどり（投稿者ID：${author}）の非表示を解除`,exact:true}).click();
 await expect(monitor.locator('#hidden-authors li')).toHaveCount(0);
 await expect(monitor.locator('.hidden-count-badge')).toHaveText('0');
 await expect(monitor.locator('#messages')).toContainText('APIからだけの本文');
 await expect(monitor.getByTestId('jev-status')).toContainText('停止');
 await monitor.keyboard.press('Escape');
 burst=true;
 await monitor.getByRole('button',{name:'取得を開始',exact:true}).click();
 await expect(monitor.locator('#hidden-authors li')).toContainText(author,{timeout:15000});
 await expect(monitor.locator('#hidden-authors .hidden-trigger-text')).toHaveText('公式取得fixtureの連投');
 await expect(monitor.locator('.hidden-count-badge')).toHaveText('1');
 await monitor.getByRole('button',{name:'取得を停止',exact:true}).click();
 fail=true;
 await monitor.getByRole('button',{name:'取得を開始',exact:true}).click();
 await expect(monitor.getByRole('status')).toContainText('一時的に利用できません',{timeout:15000});
 const result=await options.evaluate(()=>chrome.runtime.sendMessage({type:'hidden.list',videoId:'abcdefghijk'}));expect(result).toEqual({ok:false});
 await options.getByRole('button',{name:'全配信の非表示データを削除',exact:true}).click();
 await options.getByRole('dialog').getByRole('button',{name:'削除する',exact:true}).click();
 await expect(options.getByTestId('hidden-clear-status')).toContainText('削除しました');
 expect(await options.evaluate(()=>chrome.runtime.sendMessage({type:'confirmation.get'}))).toEqual({ok:true,value:{confirmed:true,version:CONFIRMATION_VERSION}});
 expect(await worker.evaluate(async()=> (await chrome.storage.local.get(['usage.confirmation']))['usage.confirmation'])).toEqual({version:CONFIRMATION_VERSION});
 await expect(monitor.getByRole('status')).toContainText('非表示データの削除');
 await expect(monitor.locator('#hidden-authors li')).toHaveCount(0);
 await expect(monitor.locator('.hidden-count-badge')).toHaveText('0');
 expect(await worker.evaluate(async () => Object.keys(await chrome.storage.local.get(null)).filter(key => key.startsWith('hiddenAuthors.')))).toEqual([]);
 await expect(monitor.getByTestId('jev-status')).toContainText('停止');
 await expect(monitor.locator('#messages')).toContainText('APIからだけの本文');
 await expect(monitor.locator('#messages')).toContainText('公式取得fixtureの連投');
 }finally{await context.close();await rm(profile,{recursive:true,force:true});}
});

test('MV3: 遅延移行→再起動/キー削除でも一覧解除→同配信者の別ライブで旧保存から復活せず、別配信者/未解決は分離', async () => {
 test.setTimeout(90000);
 const profile = await mkdtemp(join(tmpdir(), 'agent-moderator-hidden-restart-'));
 const extension = resolve('dist'); let context: BrowserContext | undefined; let calls = 0; let pages = 0; let avatars = 0;
 const requests: string[] = [];
 const launch = async () => {
   const ctx = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
     args: ['--enable-unsafe-extension-debugging', `--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
   await ctx.route('https://www.youtube.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>視聴fixture</h1>' }));
   await ctx.route('https://yt3.ggpht.com/**', route => { avatars++; return route.abort(); });
   await ctx.route('https://www.googleapis.com/youtube/v3/**', route => {
     const url = new URL(route.request().url()); calls++;
     if (url.pathname.endsWith('/videos')) {
       const selected = url.searchParams.get('id')!; requests.push(selected);
       expect(url.searchParams.get('part')?.split(',').sort()).toEqual(['liveStreamingDetails', 'snippet']);
       return route.fulfill({ json: { items: [{ id: selected, snippet: selected === '44444444444' ? {} :
         { channelId: selected === '33333333333' ? 'UC1111111111111111111111' : broadcaster }, liveStreamingDetails: { activeLiveChatId: `chat-${selected}` } }] } });
     }
     return route.fulfill({ json: { nextPageToken: `next-${++pages}`, pollingIntervalMillis: 5000, items: [{ id: `post-${pages}`,
       snippet: { type: 'textMessageEvent', hasDisplayContent: true, displayMessage: '同じ投稿者の本文', publishedAt: new Date().toISOString() },
       authorDetails: { channelId: author, displayName: 'みどり', profileImageUrl: 'https://yt3.ggpht.com/fixture=s48-c' } }] } });
   });
   return ctx;
 };
 const open = async (selected: string) => {
   const ctx = context!; const worker = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker'); const id = new URL(worker.url()).hostname;
   const watch = await ctx.newPage(); await watch.goto(`https://www.youtube.com/watch?v=${selected}`); await watch.bringToFront();
   const cdp = await ctx.browser()!.newBrowserCDPSession(); const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] });
   await cdp.send('Extensions.triggerAction', { id, targetId: targetInfos.find(t => t.type === 'tab' && t.url === watch.url())!.targetId });
   const pp = ctx.waitForEvent('page'); await worker.evaluate(id => chrome.tabs.create({ url: `chrome-extension://${id}/popup.html`, active: false }), id);
   const popup = await pp; const closed = popup.waitForEvent('close');
   await popup.getByRole('button', { name: 'この動画のチャットを取得' }).click(); await closed;
   const monitorTabId = await worker.evaluate(async () => ((await chrome.storage.session.get(['youtube.monitorBinding']))['youtube.monitorBinding'] as { monitorTabId: number }).monitorTabId);
   let selectedViewer: Page | undefined;
   await expect.poll(async () => {
     for (const page of ctx.pages().filter(page => page.url() === `chrome-extension://${id}/monitor.html`)) {
       const tab = await page.evaluate(() => chrome.tabs.getCurrent()).catch(() => undefined);
       if (tab?.id === monitorTabId) { selectedViewer = page; return true; }
     }
     return false;
   }).toBe(true);
   const viewer = selectedViewer!;
   await expect(viewer.locator('.viewer-header')).toContainText(selected);
   // Test-only reset: server waiting behavior is covered independently, not bypassed by production.
   await worker.evaluate(() => chrome.storage.session.set({ 'youtube.cooldown': { interval: 5000, notBefore: 0 } }));
   return { viewer, worker };
 };
 try {
   context = await launch(); const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); const id = new URL(worker.url()).hostname;
   await worker.evaluate(({ video, author }) => chrome.storage.local.set({
     [`hiddenAuthors.${video}`]: { ids: [author], revisions: {}, displayNames: { [author]: 'みどり' } },
     'hiddenAuthors.22222222222': { ids: [author], revisions: {} }, 'hiddenAuthors.99999999999': { ids: [author], revisions: {} },
     'apiKey.youtube': 'synthetic-protected', 'usage.confirmation': { version: 2 },
   }), { video, author });
   const options = await context.newPage(); await options.goto(`chrome-extension://${id}/options.html`);
   let current = await open(video);
   await expect(current.viewer.getByRole('button', { name: '取得を開始', exact: true })).toBeEnabled();
   await expect(current.viewer.locator('.chat-scroll .empty-list')).toContainText('確認');
   await current.viewer.getByRole('button', { name: '取得を開始', exact: true }).click();
   await expect(current.viewer.getByRole('status')).toContainText('同意'); expect(calls).toBe(0); expect(avatars).toBe(0);
   await confirmUsage(options);
   await current.viewer.getByRole('button', { name: '取得を開始', exact: true }).click();
   await expect(current.viewer.locator('#hidden-authors li')).toContainText('みどり', { timeout: 15000 });
   await expect.poll(() => pages, { timeout: 15000 }).toBe(1); await expect(current.viewer.locator('#messages li')).toHaveCount(0); expect(avatars).toBe(0);
   await current.viewer.getByRole('button', { name: '取得を停止', exact: true }).click();
   current = await open('11111111111'); await current.viewer.getByRole('button', { name: '取得を開始', exact: true }).click();
   await expect.poll(() => pages, { timeout: 15000 }).toBe(2);
   await expect(current.viewer.locator('#hidden-authors li')).toContainText('みどり'); await expect(current.viewer.locator('#messages li')).toHaveCount(0); expect(avatars).toBe(0);
   await context.close(); context = await launch();
   const restarted = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker'); const restartedId = new URL(restarted.url()).hostname;
   const settings = await context.newPage(); await settings.goto(`chrome-extension://${restartedId}/options.html`);
   await settings.getByRole('button', { name: 'YouTubeキーを削除', exact: true }).click();
   await expect(settings.getByTestId('youtube-status')).toHaveText('未設定：設定が必要です。');
   const before = calls; current = await open(video);
   await expect(current.viewer.locator('#hidden-authors li')).toContainText('みどり');
   await expect(current.viewer.getByRole('button', { name: '取得を開始', exact: true })).toBeDisabled(); expect(calls).toBe(before);
   await current.viewer.getByRole('button', { name: '非表示一覧', exact: true }).click();
   await current.viewer.getByRole('button', { name: `みどり（投稿者ID：${author}）の非表示を解除`, exact: true }).click();
   await expect(current.viewer.locator('#hidden-authors li')).toHaveCount(0); expect(calls).toBe(before);
   await settings.getByLabel('YouTube APIキー').fill('synthetic-restored'); await settings.getByRole('button', { name: 'YouTubeキーを保存', exact: true }).click();
   current = await open('22222222222'); await current.viewer.getByRole('button', { name: '取得を開始', exact: true }).click();
   await expect(current.viewer.locator('#messages')).toContainText('同じ投稿者の本文', { timeout: 15000 });
   await current.viewer.getByRole('button', { name: '取得を停止', exact: true }).click();
   await expect(current.viewer.locator('#hidden-authors li')).toHaveCount(0);
   const state = await restarted.evaluate(async broadcaster => (await chrome.storage.local.get([`hiddenAuthors.channel.${broadcaster}`]))[`hiddenAuthors.channel.${broadcaster}`], broadcaster);
   expect(state).toMatchObject({ ids: [], revisions: { [author]: 1 }, migratedVideos: [video, '22222222222'] });
   current = await open('33333333333'); await current.viewer.getByRole('button', { name: '取得を開始', exact: true }).click();
   await expect(current.viewer.locator('#messages')).toContainText('同じ投稿者の本文', { timeout: 15000 });
   await current.viewer.getByRole('button', { name: '取得を停止', exact: true }).click();
   const beforeFailure = pages; current = await open('44444444444');
   await current.viewer.getByRole('button', { name: '取得を開始', exact: true }).click();
   await expect(current.viewer.getByRole('status')).toContainText('確認できず');
   await expect(current.viewer.locator('#messages li')).toHaveCount(0); await expect(current.viewer.locator('.empty-list:visible')).not.toContainText('非表示投稿者はいません');
   expect(pages).toBe(beforeFailure); expect(requests).toEqual([video, '11111111111', '22222222222', '33333333333', '44444444444']);
   expect(await restarted.evaluate(async () => (await chrome.storage.local.get(['hiddenAuthors.99999999999']))['hiddenAuthors.99999999999'])).toBeDefined();
 } finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
});
