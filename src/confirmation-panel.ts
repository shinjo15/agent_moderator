import type { runtime } from './extension-runtime';
import { CONFIRMATION_VERSION } from './confirmation';
import { t } from './i18n';

export function createConfirmationPanel(main: HTMLElement, channel: Pick<typeof runtime, 'sendMessage' | 'onMessage' | 'id' | 'getURL'>) {
  const section = document.createElement('section'); section.className = 'credential-card';
  const heading = document.createElement('h2'); heading.textContent = t('confirmationTitle');
  const details = document.createElement('details'); details.open = true;
  const summary = document.createElement('summary'); summary.textContent = t('agreementDetails'); summary.hidden = true;
  const links = document.createElement('p');
  for (const [name, href] of [
    [t('termsLink'), channel.getURL('terms.html')],
    [t('privacyLink'), 'https://github.com/shinjo15/agent_moderator/blob/main/docs/privacy.md'],
    [t('youtubeTerms'), 'https://www.youtube.com/t/terms'],
    [t('googlePrivacy'), 'https://policies.google.com/privacy'],
  ]) {
    const link = document.createElement('a'); link.textContent = name; link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer';
    links.append(link, document.createElement('br'));
  }
  const explanation = document.createElement('p');
  explanation.textContent = t('confirmationExplanation');
  const jev = document.createElement('p'); jev.className = 'sending-disclosure';
  jev.textContent = t('sendingDisclosure');
  const limits = document.createElement('p'); limits.className = 'credential-help';
  limits.textContent = t('draftLimits');
  const persistence = document.createElement('p'); persistence.className = 'credential-help';
  persistence.textContent = t('agreementPersistence');
  const label = document.createElement('label');
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
  label.append(checkbox, t('agreementCheckbox'));
  const button = document.createElement('button'); button.type = 'button'; button.className = 'credential-save'; button.textContent = t('saveAgreement'); button.disabled = true;
  const status = document.createElement('p'); status.dataset.testid = 'confirmation-status'; status.setAttribute('aria-live', 'polite');
  const controls = document.createElement('div'); controls.append(label, document.createElement('br'), button);
  details.append(summary, explanation, jev, limits, persistence, controls);
  section.append(heading, links, details, status); main.append(section);
  let busy = true; let generation = 0; let refreshPending = false;
  let agreed = false;
  function displayAgreement(confirmed: boolean) {
    if (confirmed !== agreed) details.open = !confirmed;
    agreed = confirmed;
    summary.hidden = !confirmed;
    controls.hidden = confirmed;
  }
  checkbox.addEventListener('change', () => { button.disabled = busy || !checkbox.checked; });
  async function request(save = false) {
    const current = ++generation; busy = true; button.disabled = true;
    try {
      const response = await channel.sendMessage(save ? { type: 'confirmation.confirm', version: CONFIRMATION_VERSION } : { type: 'confirmation.get' });
      if (current !== generation) return;
      if (typeof response !== 'object' || response === null || !('ok' in response) || response.ok !== true || !('value' in response)
        || typeof response.value !== 'object' || response.value === null || !('version' in response.value) || response.value.version !== CONFIRMATION_VERSION
        || !('confirmed' in response.value) || typeof response.value.confirmed !== 'boolean' || (save && !response.value.confirmed)) throw new Error();
      checkbox.checked = response.value.confirmed;
      displayAgreement(response.value.confirmed);
      status.textContent = response.value.confirmed ? t('agreed', CONFIRMATION_VERSION) : t('notAgreed', t('confirmationRequired'));
    } catch {
      if (current !== generation) return;
      checkbox.checked = false;
      displayAgreement(false);
      status.textContent = t('agreementFailure');
    } finally {
      if (current === generation) {
        busy = false; button.disabled = !checkbox.checked;
        if (refreshPending) { refreshPending = false; void request(); }
      }
    }
  }
  button.addEventListener('click', () => { if (!busy && checkbox.checked) void request(true); });
  channel.onMessage.addListener((message, sender) => {
    if (sender.id === channel.id && (sender.url === undefined || sender.url === channel.getURL('background.js'))
      && typeof message === 'object' && message !== null && 'type' in message && message.type === 'confirmation.changed') {
      if (busy) refreshPending = true; else void request();
    }
    return false;
  });
  void request();
}
