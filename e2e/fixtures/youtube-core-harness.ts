// TEST ONLY: 配布物には含めない。実キー・storage・#2 moduleを利用しない。
import { createYouTubeClient } from '../../src/youtube/client';
import { createChatMonitor } from '../../src/youtube/monitor';

const client = createYouTubeClient();
const status = document.querySelector('#status')!;
const messages = document.querySelector('#messages')!;
const monitor = createChatMonitor({
  transport: {
    resolveVideo: (videoId, signal) => client.resolveVideo(videoId, 'fixture-not-a-real-api-key', signal),
    listMessages: (chatId, token, signal) => client.listMessages(chatId, token, 'fixture-not-a-real-api-key', signal),
  },
  onState: state => { status.textContent = state.error ? `${state.status}: ${state.error.code}: ${state.error.message}` : state.status; },
  onMessages: batch => {
    for (const message of batch) {
      const item = document.createElement('li');
      item.textContent = `${message.id}: ${message.authorChannelId}: ${message.text}`;
      messages.append(item);
    }
  },
});
monitor.setVideo('abcdefghijk');
monitor.credentialsChanged(true);
document.querySelector('#start')!.addEventListener('click', () => monitor.start());
document.querySelector('#stop')!.addEventListener('click', () => monitor.stop());
window.addEventListener('pagehide', () => monitor.stop());
