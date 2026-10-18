import { runtime } from './extension-runtime';
import type { ApiKeyProvider, CredentialStatus } from './credential-store';
import { createFilterSettingsPanel } from './jev/options';
import { createNotice } from './ui-notice';
import { createHiddenDataPanel } from './hidden-authors/options';
import { createConfirmationPanel } from './confirmation-panel';
import { t, initializePage } from './i18n';

initializePage('settingsTitle');

const heading = document.createElement('h1');
heading.textContent = t('settingsTitle');
const notice = createNotice('settings-notice', [
  t('settingsNotice'),
], [
  t('localStorageNotice'),
  t('youtubeCost'),
  t('jevCost'),
  t('hidingNotice'),
]);
const result = document.createElement('p');
result.setAttribute('role', 'status');
const main = document.querySelector('main')!;
main.append(heading, result);
createConfirmationPanel(main, runtime);
const fields = new Map<ApiKeyProvider, { input: HTMLInputElement; status: HTMLParagraphElement }>();
const buttons: HTMLButtonElement[] = [];
let busy = false;
const failure = t('credentialFailure');

function render(status: CredentialStatus) {
  for (const [provider, field] of fields) {
    field.status.textContent = t(status[provider] ? 'configured' : 'notConfigured');
  }
}

type CredentialRequest =
  | { type: 'storage.init' }
  | { type: 'credentials.save'; provider: ApiKeyProvider; value: string }
  | { type: 'credentials.delete'; provider: ApiKeyProvider };

async function request(message: CredentialRequest) {
  if (busy) return;
  busy = true;
  for (const button of buttons) button.disabled = true;
  result.textContent = t(message.type === 'storage.init' ? 'checkingKeys' : 'processingKeys');
  try {
    const response = await runtime.sendMessage(message);
    if (typeof response !== 'object' || response === null || !('ok' in response) || response.ok !== true ||
        !('status' in response) || typeof response.status !== 'object' || response.status === null ||
        !('jev' in response.status) || typeof response.status.jev !== 'boolean' ||
        !('youtube' in response.status) || typeof response.status.youtube !== 'boolean') {
      throw new Error(failure);
    }
    render({ jev: response.status.jev, youtube: response.status.youtube });
    result.textContent = t(message.type === 'storage.init' ? 'keysChecked'
      : message.type === 'credentials.save' ? 'keySaved' : 'keyDeleted');
  } catch {
    result.textContent = failure;
  } finally {
    // Clear only the operated provider, even on failure. Init submits no key.
    if (message.type !== 'storage.init') fields.get(message.provider)!.input.value = '';
    busy = false;
    for (const button of buttons) button.disabled = false;
  }
}

for (const [provider, name] of [['jev', 'Jev'], ['youtube', 'YouTube']] as const) {
  const section = document.createElement('section');
  section.className = 'credential-card';
  const title = document.createElement('h2');
  title.id = `${provider}-title`;
  title.className = 'credential-title';
  title.textContent = t(provider === 'jev' ? 'jevPurpose' : 'youtubePurpose');
  section.setAttribute('aria-labelledby', title.id);
  const description = document.createElement('p');
  description.id = `${provider}-description`;
  description.className = 'credential-help';
  description.textContent = t(provider === 'jev' ? 'jevHelp' : 'youtubeHelp');
  const label = document.createElement('label');
  label.className = 'credential-label';
  label.htmlFor = `${provider}-key`;
  label.textContent = t('apiKey', name);
  const input = document.createElement('input');
  input.className = 'credential-input';
  input.id = label.htmlFor;
  input.type = 'password';
  input.placeholder = t('enterKey', name);
  input.setAttribute('aria-describedby', description.id);
  input.autocomplete = 'off';
  input.spellcheck = false;
  const status = document.createElement('p');
  status.className = 'credential-status';
  status.dataset.testid = `${provider}-status`;
  status.textContent = t('checkingSettings');
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'credential-save';
  save.textContent = t('saveKey', name);
  save.addEventListener('click', () => { void request({ type: 'credentials.save', provider, value: input.value }); });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'credential-delete';
  remove.textContent = t('deleteKey', name);
  remove.addEventListener('click', () => { void request({ type: 'credentials.delete', provider }); });
  buttons.push(save, remove);
  fields.set(provider, { input, status });
  const actions = document.createElement('div');
  actions.className = 'credential-actions';
  actions.append(save, remove);
  section.append(title, description, label, input, status, actions);
  main.append(section);
}
createFilterSettingsPanel(main, runtime);
createHiddenDataPanel(main, runtime);
main.append(notice);
void request({ type: 'storage.init' });
