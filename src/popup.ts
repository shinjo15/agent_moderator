import { runtime } from './extension-runtime';
import { platform } from './youtube/extension-platform';
import { videoIdFromUrl } from './youtube/video-id';

const heading = document.createElement('h1');
heading.textContent = 'Agent Moderator';
const notice = document.createElement('p');
notice.textContent = '配信別に投稿者を画面内で非表示にします。監視停止後も非表示は維持され、monitorから解除できます。YouTube上でのBAN・コメント削除は行いません。';
const settings = document.createElement('a');
settings.textContent = '設定を開く';
settings.href = 'options.html';
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
