import { deleteApiKey, getCredentialStatus, initializeCredentialStorage, readYouTubeApiKeyForBackground, readJevApiKeyForBackground, saveApiKey } from './credential-store';
import { runtime } from './extension-runtime';
import { createYouTubeClient } from './youtube/client';
import { createYouTubeHandler } from './youtube/background-handler';
import { platform } from './youtube/extension-platform';
import { createJevClient } from './jev/client';
import { createModeration } from './jev/moderation';
import { createHiddenAuthors } from './hidden-authors/store';
import { createHiddenAuthorHandler } from './hidden-authors/handler';

const moderation = createModeration({ client: createJevClient(), readKey: readJevApiKeyForBackground, session: platform.storage.session });
const hiddenAuthors = createHiddenAuthors({ storage: platform.storage.local, initialize: initializeCredentialStorage });
const hidden = createHiddenAuthorHandler({ store: hiddenAuthors, tabs: platform.tabs, session: platform.storage.session, runtime });
const youtube = createYouTubeHandler({ session: platform.storage.session, tabs: platform.tabs, runtime, moderation,
  hiddenAuthors, client: createYouTubeClient(), initialize: initializeCredentialStorage, readApiKey: readYouTubeApiKeyForBackground });
platform.storage.onChanged?.addListener((changes, area) => {
  if (area === 'local' && 'apiKey.youtube' in changes) void youtube.credentialsChanged().catch(() => {});
  if (area === 'local' && 'apiKey.jev' in changes) {
    moderation.stop();
    void runtime.sendMessage({ type: 'jev.credentialsChanged' }).catch(() => {});
  }
});
platform.tabs?.onUpdated?.addListener((id, change) => {
  if (change.url !== undefined) void youtube.targetChanged(id, change.url).catch(() => {});
});
platform.tabs?.onRemoved?.addListener(id => { void youtube.targetChanged(id).catch(() => {}); });

// Start the gate on every worker activation, even before any settings message.
void initializeCredentialStorage().catch(() => {});

const denied = { ok: false, error: 'この要求は許可されていません。' };

runtime.onMessageExternal.addListener((_message, _sender, reply) => {
  reply(denied);
  return false;
});

runtime.onMessage.addListener((message, sender, reply) => {
  if (typeof message === 'object' && message !== null && 'type' in message && typeof message.type === 'string' && message.type.startsWith('hidden.')) {
    void hidden.handle(message, sender).then(reply); return true;
  }
  if (typeof message === 'object' && message !== null && 'type' in message &&
      typeof message.type === 'string' && (message.type.startsWith('youtube.') || message.type.startsWith('jev.'))) {
    void youtube.handle(message, sender).then(reply);
    return true;
  }
  if (sender.id !== runtime.id ||
      ![runtime.getURL('options.html'), runtime.getURL('popup.html')].includes(sender.url ?? '')) {
    reply(denied);
    return false;
  }
  void (async () => {
    if (typeof message !== 'object' || message === null || !('type' in message)) {
      reply(denied);
      return;
    }
    if (message.type === 'storage.init') {
      reply({ ok: true, status: await getCredentialStatus() });
      return;
    }
    if ('provider' in message && (message.provider === 'jev' || message.provider === 'youtube')) {
      if (message.type === 'credentials.save' && 'value' in message && typeof message.value === 'string') {
        await saveApiKey(message.provider, message.value);
        reply({ ok: true, status: await getCredentialStatus() });
        return;
      }
      if (message.type === 'credentials.delete') {
        await deleteApiKey(message.provider);
        reply({ ok: true, status: await getCredentialStatus() });
        return;
      }
    }
    reply(denied);
  })().catch(() => reply({ ok: false, error: 'キー設定の処理に失敗しました。再試行してください。' }));
  return true;
});
