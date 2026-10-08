import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { apiResponse } from '../tests/fixtures/jev';
declare const chrome: { tabs: { create(o: {url:string;active:boolean}):Promise<unknown> }; runtime:{sendMessage(m:unknown):Promise<unknown>}; storage:{local:{get(keys:string[]):Promise<Record<string,unknown>>;set(v:Record<string,unknown>):Promise<void>}} };
const author = 'UCabcdefghijklmnopqrstuv'; const other = 'UCzyxwvutsrqponmlkjihgfe'; const video = 'abcdefghijk';
const chat = `<!doctype html><body><script>
function append(id,author){const e=document.createElement('yt-live-chat-text-message-renderer');e.id=id;e.textContent='みどり: こんにちは';e.data={authorExternalChannelId:author};document.body.append(e);return e;}
append('existing','${author}');append('other','${other}');append('unknown',undefined);
</script></body>`;

test('MV3: official→Jev→既存/新着非表示、同名別author・iframe/popout・再利用・停止維持・解除復元',async()=>{
 test.setTimeout(90000);
 const profile=await mkdtemp(join(tmpdir(),'agent-moderator-hidden-'));
 const extension=resolve('dist');
 const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:['--enable-unsafe-extension-debugging',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 try{
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=new URL(worker.url()).hostname;
 await context.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:route.request().url().includes('/live_chat')?chat:`<!doctype html><iframe src="https://www.youtube.com/live_chat?continuation=fixture"></iframe>`}));
 let pages=0; let burst=false; let fail=false;
 await context.route('https://www.googleapis.com/youtube/v3/**',route=>{
 const url=new URL(route.request().url());
 if (fail && !url.pathname.endsWith('/videos')) return route.fulfill({status:503,body:'fixture-unavailable'});
 if (burst && !url.pathname.endsWith('/videos')) return route.fulfill({json:{nextPageToken:`burst-${++pages}`,pollingIntervalMillis:5000,items:Array.from({length:10},(_,n)=>({id:`burst-${pages}-${n}`,snippet:{type:'textMessageEvent',hasDisplayContent:true,displayMessage:'公式取得fixtureの連投',publishedAt:new Date(Date.UTC(2026,0,1,0,1,n)).toISOString()},authorDetails:{channelId:author,displayName:'みどり'}}))}});
 return route.fulfill({json:url.pathname.endsWith('/videos')?{items:[{id:video,liveStreamingDetails:{activeLiveChatId:'fixture-chat'}}]}:{nextPageToken:`next-${++pages}`,pollingIntervalMillis:5000,items:[{id:`post-${pages}`,snippet:{type:'textMessageEvent',hasDisplayContent:true,displayMessage:'APIからだけの本文',publishedAt:new Date(2026,0,1,0,0,pages*5).toISOString()},authorDetails:{channelId:author,displayName:'みどり'}}]}});
 });
 let releaseJev: (() => void) | undefined;
 await context.route('https://api.typesafe.ai/v1/systemone',async route=>{
 expect(JSON.stringify(route.request().postDataJSON().state)).not.toContain('みどり');
 if (!releaseJev) await new Promise<void>(done => { releaseJev = done; });
 await route.fulfill({json:apiResponse({attack:0.8})});
 });
 const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);
 for(const p of ['YouTube','Jev']){await options.getByLabel(`${p} APIキー`).fill(`synthetic-${p}`);await options.getByRole('button',{name:`${p}キーを保存`,exact:true}).click();await expect(options.getByLabel(`${p} APIキー`)).toHaveValue('');}
 const youtube=await context.newPage();await youtube.goto(`https://www.youtube.com/watch?v=${video}`);await youtube.bringToFront();
 const cdp=await context.browser()!.newBrowserCDPSession();const {targetInfos}=await cdp.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]});
 await cdp.send('Extensions.triggerAction',{id,targetId:targetInfos.find(t=>t.type==='tab'&&t.url===youtube.url())!.targetId});
 const pp=context.waitForEvent('page');await worker.evaluate(id=>chrome.tabs.create({url:`chrome-extension://${id}/popup.html`,active:false}),id);const popup=await pp;
 const mp=context.waitForEvent('page');await popup.getByRole('button',{name:'この動画のチャットを取得'}).click();const monitor=await mp;
 await expect(monitor.getByRole('button',{name:'取得を開始',exact:true})).toBeEnabled();
 const frame=youtube.frames().find(f=>f.url().includes('/live_chat'))!;
 const popout=await context.newPage();await popout.goto(`https://www.youtube.com/live_chat?v=${video}&is_popout=1`);
 await expect(frame.locator('#existing')).toBeVisible();
 await monitor.getByRole('button',{name:'Jev判定を有効化・再開'}).click();await expect(monitor.getByTestId('jev-status')).toContainText('有効');
 await monitor.getByRole('button',{name:'取得を開始',exact:true}).click();
 await expect.poll(()=>typeof releaseJev,{timeout:15000}).toBe('function');
 await expect(frame.locator('#existing')).toBeVisible();await expect(monitor.locator('#hidden-authors li')).toHaveCount(0);
 releaseJev!();
 await expect(monitor.locator('#hidden-authors li')).toContainText(author,{timeout:15000});

 await expect(frame.locator('#existing')).toBeHidden();await expect(popout.locator('#existing')).toBeHidden();
 await expect(frame.locator('#other')).toBeVisible();await expect(frame.locator('#unknown')).toBeVisible();
 await frame.evaluate(author=>{const e=document.createElement('yt-live-chat-text-message-renderer');e.id='new';e.textContent='新着';(e as unknown as {data:unknown}).data={authorExternalChannelId:author};document.body.append(e);},author);
 await expect(frame.locator('#new')).toBeHidden();
 await frame.evaluate(other=>{const e=document.getElementById('new')!;e.id='reused';(e as unknown as {data:unknown}).data={authorExternalChannelId:other};e.textContent='再利用';},other);
 await expect(frame.locator('#reused')).toBeVisible();
 await monitor.getByRole('button',{name:'取得を停止',exact:true}).click();await expect(frame.locator('#existing')).toBeHidden();
 const switchedDisplay = await popout.evaluate(async author => {
   history.replaceState({}, '', '/live_chat?v=zyxwvutsrqp&is_popout=1');
   const e=document.createElement('yt-live-chat-text-message-renderer');e.id='new-video-node';e.textContent='新しい配信';(e as unknown as {data:unknown}).data={authorExternalChannelId:author};document.body.append(e);
   await Promise.resolve();await Promise.resolve();return getComputedStyle(e).display;
 },author);
 expect(switchedDisplay).not.toBe('none');
 await popout.goto(`https://www.youtube.com/live_chat?v=${video}&is_popout=1`);
 await monitor.getByRole('button',{name:`みどり（投稿者ID：${author}）の非表示を解除`,exact:true}).click();
 await expect(frame.locator('#existing')).toBeVisible();await expect(popout.locator('#existing')).toBeVisible();
 await expect(monitor.locator('#hidden-authors li')).toHaveCount(0);
 await expect(monitor.getByTestId('jev-status')).toContainText('停止');
 burst=true;
 await monitor.getByRole('button',{name:'取得を開始',exact:true}).click();
 await expect(monitor.locator('#hidden-authors li')).toContainText(author,{timeout:15000});
 await expect(frame.locator('#existing')).toBeHidden();
 await monitor.getByRole('button',{name:'取得を停止',exact:true}).click();
 await frame.evaluate(author=>{const e=document.createElement('yt-live-chat-text-message-renderer');e.id='stopped-new';e.textContent='停止中の新着';(e as unknown as {data:unknown}).data={authorExternalChannelId:author};document.body.append(e);},author);
 await expect(frame.locator('#stopped-new')).toBeHidden();
 fail=true;
 await monitor.getByRole('button',{name:'取得を開始',exact:true}).click();
 await expect(monitor.getByRole('status')).toContainText('一時的に利用できません',{timeout:15000});
 await expect(frame.locator('#existing')).toBeHidden();
 const result=await options.evaluate(()=>chrome.runtime.sendMessage({type:'hidden.list',videoId:'abcdefghijk'}));expect(result).toEqual({ok:false});
 }finally{await context.close();await rm(profile,{recursive:true,force:true});}
});

test('MV3: browser再起動・キーなし/監視なしでもvideo別リスト維持、大量DOMとcontent秘密境界',async()=>{
 test.setTimeout(60000);
 const profile=await mkdtemp(join(tmpdir(),'agent-moderator-hidden-restart-'));
 const extension=resolve('dist');let context: BrowserContext | undefined;
 const launch=()=>chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 try{
 context=await launch();const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 await worker.evaluate(async ({video,author})=>{await chrome.storage.local.set({[`hiddenAuthors.${video}`]:{ids:[author],revisions:{}},'apiKey.youtube':'synthetic-protected'});},{video,author});
 expect(await worker.evaluate(async ({video,author})=>((await chrome.storage.local.get([`hiddenAuthors.${video}`]))[`hiddenAuthors.${video}`] as {ids:string[]}).ids.includes(author),{video,author})).toBe(true);
 await context.close();context=await launch();const restarted=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=new URL(restarted.url()).hostname;
 await context.route('https://www.youtube.com/**',route=>route.fulfill({contentType:'text/html',body:route.request().url().includes('/live_chat')?chat:`<!doctype html><iframe src="https://www.youtube.com/live_chat?continuation=fixture"></iframe>`}));
 const watch=await context.newPage();await watch.goto(`https://www.youtube.com/watch?v=${video}`);const frame=watch.frames().find(f=>f.url().includes('/live_chat'))!;
 await expect(frame.locator('#existing')).toBeHidden();
 const page=await context.newPage();const cdp=await context.newCDPSession(page);
 const worlds:{id:number;origin:string;auxData?:{type?:string}}[]=[];cdp.on('Runtime.executionContextCreated',event=>worlds.push(event.context));await cdp.send('Runtime.enable');
 await page.goto(`https://www.youtube.com/live_chat?v=${video}&is_popout=1`);await expect(page.locator('#existing')).toBeHidden();
 await expect.poll(()=>worlds.some(w=>w.origin===`chrome-extension://${id}`&&w.auxData?.type==='isolated')).toBe(true);
 const world=worlds.find(w=>w.origin===`chrome-extension://${id}`&&w.auxData?.type==='isolated')!;
 const response=await cdp.send('Runtime.evaluate',{contextId:world.id,awaitPromise:true,returnByValue:true,expression:`(async()=>{let localDenied=false;try{await chrome.storage.local.get(null);}catch{localDenied=true;}return {localDenied,ids:await chrome.runtime.sendMessage({type:'hidden.list',videoId:'${video}',referrer:''}),remove:await chrome.runtime.sendMessage({type:'hidden.remove',videoId:'${video}',authorChannelId:'${author}'})};})()`});
 expect(response.result.value).toEqual({localDenied:true,ids:{ok:true,videoId:video,ids:[author]},remove:{ok:false}});
 await page.evaluate(author=>{for(let n=0;n<1000;n++){const e=document.createElement('yt-live-chat-text-message-renderer');e.id=`large-${n}`;e.textContent='fixture';(e as unknown as {data:unknown}).data={authorExternalChannelId:author};document.body.append(e);}},author);
 await expect(page.locator('#large-999')).toBeHidden();
 await page.goto('https://www.youtube.com/live_chat?v=zyxwvutsrqp&is_popout=1');await expect(page.locator('#existing')).toBeVisible();
 const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);await options.getByRole('button',{name:'YouTubeキーを削除',exact:true}).click();
 await page.goto(`https://www.youtube.com/live_chat?v=${video}&is_popout=1`);await expect(page.locator('#existing')).toBeHidden();
 }finally{await context?.close();await rm(profile,{recursive:true,force:true});}
});
