import { runtime } from './extension-runtime';
import { platform } from './youtube/extension-platform';
import { videoIdFromUrl } from './youtube/video-id';
import { createNotice } from './ui-notice';

const heading = document.createElement('h1');
heading.textContent = 'Agent Moderator';
const notice = createNotice('popup-notice', [
  '悪質と判定した投稿者のコメントを、配信ごとにあなたの画面だけで非表示にします。',
  '取得を停止しても非表示は続き、チャット画面で解除できます。YouTube上のBANやコメント削除はしません。',
]);
const settings = document.createElement('button');
settings.textContent = '設定を開く';
settings.type = 'button';
settings.addEventListener('click', () => { window.location.assign('options.html'); });
document.querySelector('main')!.append(heading, notice, settings);
const selection = document.createElement('p');
const open = document.createElement('button');
open.textContent = 'この動画のチャットを取得';
open.disabled = true;
document.querySelector('main')!.append(selection, open);
void (async () => {
  try {
    const [tab] = await platform.tabs.query({ active: true, currentWindow: true });
    const videoId = videoIdFromUrl(tab?.url);
    if (tab?.id === undefined || !videoId) {
      selection.textContent = 'YouTubeの視聴タブで拡張アイコンを押してください。';
      return;
    }
    selection.textContent = `対象動画: ${videoId}`;
    open.disabled = false;
    open.addEventListener('click', () => {
      open.disabled = true;
      void runtime.sendMessage({ type: 'youtube.openMonitor', tabId: tab.id, videoId }).then(response => {
        if (typeof response !== 'object' || response === null || !('ok' in response) || response.ok !== true) throw new Error();
        window.close();
      }).catch(() => {
        selection.textContent = '対象動画を確認できませんでした。視聴タブから選び直してください。';
        open.disabled = false;
      });
    });
  } catch { selection.textContent = '視聴タブの取得に失敗しました。拡張アイコンから再度開いてください。'; }
})();
