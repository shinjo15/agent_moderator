import { deleteApiKey, getCredentialStatus, initializeCredentialStorage, saveApiKey } from './credential-store';
import { runtime } from './extension-runtime';

// Start the gate on every worker activation, even before any settings message.
void initializeCredentialStorage().catch(() => {});

const denied = { ok: false, error: 'この要求は許可されていません。' };

runtime.onMessageExternal.addListener((_message, _sender, reply) => {
  reply(denied);
  return false;
});

runtime.onMessage.addListener((message, sender, reply) => {
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
