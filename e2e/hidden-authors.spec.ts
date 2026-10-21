import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { apiResponse } from '../tests/fixtures/jev';
import { confirmUsage } from './fixtures/confirm-usage';
import { CONFIRMATION_VERSION } from '../src/confirmation';
declare const chrome: { tabs: { create(o: {url:string;active:boolean}):Promise<unknown> }; runtime:{sendMessage(m:unknown):Promise<unknown>}; storage:{local:{get(keys:string[]):Promise<Record<string,unknown>>;set(v:Record<string,unknown>):Promise<void>}} };
const author = 'UCabcdefghijklmnopqrstuv'; const video = 'abcdefghijk';

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
 return route.fulfill({json:url.pathname.endsWith('/videos')?{items:[{id:video,liveStreamingDetails:{activeLiveChatId:'fixture-chat'}}]}:{nextPageToken:`next-${++pages}`,pollingIntervalMillis:5000,items:[{id:`post-${pages}`,snippet:{type:'textMessageEvent',hasDisplayContent:true,displayMessage:'APIからだけの本文',publishedAt:new Date(2026,0,1,0,0,pages*5).toISOString()},authorDetails:{channelId:author,displayName:'みどり'}}]}});
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

 expect(await worker.evaluate(async video => (await chrome.storage.local.get([`hiddenAuthors.${video}`]))[`hiddenAuthors.${video}`], video))
   .toMatchObject({ ids: [author], displayNames: { [author]: 'みどり' } });
 await monitor.getByRole('button',{name:'取得を停止',exact:true}).click();
 await monitor.getByRole('button',{name:`みどり（投稿者ID：${author}）の非表示を解除`,exact:true}).click();
 await expect(monitor.locator('#hidden-authors li')).toHaveCount(0);
 await expect(monitor.getByTestId('jev-status')).toContainText('停止');
 burst=true;
 await monitor.getByRole('button',{name:'取得を開始',exact:true}).click();
 await expect(monitor.locator('#hidden-authors li')).toContainText(author,{timeout:15000});
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
 await expect(monitor.getByTestId('jev-status')).toContainText('停止');
 }finally{await context.close();await rm(profile,{recursive:true,force:true});}
});

test('MV3: ブラウザ再起動・キー削除・監視なしでも配信別の保存リストを維持する',async()=>{
 test.setTimeout(60000);
 const profile=await mkdtemp(join(tmpdir(),'agent-moderator-hidden-restart-'));
 const extension=resolve('dist');let context: BrowserContext | undefined;
 const launch=()=>chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 try{
 context=await launch();const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
 await worker.evaluate(async ({video,author})=>{await chrome.storage.local.set({[`hiddenAuthors.${video}`]:{ids:[author],revisions:{}},'apiKey.youtube':'synthetic-protected'});},{video,author});
 expect(await worker.evaluate(async ({video,author})=>((await chrome.storage.local.get([`hiddenAuthors.${video}`]))[`hiddenAuthors.${video}`] as {ids:string[]}).ids.includes(author),{video,author})).toBe(true);
 await context.close();context=await launch();const restarted=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');const id=new URL(restarted.url()).hostname;
 const options=await context.newPage();await options.goto(`chrome-extension://${id}/options.html`);await options.getByRole('button',{name:'YouTubeキーを削除',exact:true}).click();
 await expect(options.getByTestId('youtube-status')).toHaveText('未設定：設定が必要です。');
 expect(await restarted.evaluate(async ({video,author})=>((await chrome.storage.local.get([`hiddenAuthors.${video}`]))[`hiddenAuthors.${video}`] as {ids:string[]}).ids,{video,author})).toEqual([author]);
 expect(await restarted.evaluate(async () => (await chrome.storage.local.get(['hiddenAuthors.zyxwvutsrqp']))['hiddenAuthors.zyxwvutsrqp'])).toBeUndefined();
 }finally{await context?.close();await rm(profile,{recursive:true,force:true});}
});
