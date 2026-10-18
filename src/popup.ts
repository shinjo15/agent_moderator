import { runtime } from './extension-runtime';
import { platform } from './youtube/extension-platform';
import { videoIdFromUrl } from './youtube/video-id';
import { createNotice } from './ui-notice';
import { t, initializePage } from './i18n';

initializePage('appName');

const heading = document.createElement('h1');
heading.textContent = t('appName');
const notice = createNotice('popup-notice', [
  t('popupNotice'),
  t('popupPersistence'),
]);
const settings = document.createElement('button');
settings.textContent = t('openSettings');
settings.type = 'button';
settings.addEventListener('click', () => { window.location.assign('options.html'); });
document.querySelector('main')!.append(heading, notice, settings);
const selection = document.createElement('p');
const open = document.createElement('button');
open.textContent = t('collectVideo');
open.disabled = true;
document.querySelector('main')!.append(selection, open);
void (async () => {
  try {
    const [tab] = await platform.tabs.query({ active: true, currentWindow: true });
    const videoId = videoIdFromUrl(tab?.url);
    if (tab?.id === undefined || !videoId) {
      selection.textContent = t('selectTab');
      return;
    }
    selection.textContent = t('targetVideo', videoId);
    open.disabled = false;
    open.addEventListener('click', () => {
      open.disabled = true;
      void runtime.sendMessage({ type: 'youtube.openMonitor', tabId: tab.id, videoId }).then(response => {
        if (typeof response !== 'object' || response === null || !('ok' in response) || response.ok !== true) throw new Error();
        window.close();
      }).catch(() => {
        selection.textContent = t('targetFailed');
        open.disabled = false;
      });
    });
  } catch { selection.textContent = t('tabFailed'); }
})();
