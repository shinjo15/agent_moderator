import type { runtime } from '../extension-runtime';
import { t } from '../i18n';
export function createHiddenDataPanel(main: HTMLElement, transport: Pick<typeof runtime, 'sendMessage'>) {
  const section = document.createElement('section'); section.className = 'credential-card';
  const title = document.createElement('h2'); title.id = 'hidden-clear-title'; title.className = 'credential-title'; title.textContent = t('clearTitle');
  section.setAttribute('aria-labelledby', title.id);
  const note = document.createElement('p'); note.className = 'credential-help';
  note.textContent = t('clearNote');
  const open = document.createElement('button'); open.type = 'button'; open.className = 'credential-delete'; open.textContent = t('clearTitle');
  const status = document.createElement('p'); status.setAttribute('aria-live', 'polite'); status.dataset.testid = 'hidden-clear-status';
  const dialog = document.createElement('dialog'); dialog.setAttribute('aria-labelledby', 'hidden-clear-confirm');
  const heading = document.createElement('h2'); heading.id = 'hidden-clear-confirm'; heading.textContent = t('clearQuestion');
  const explanation = document.createElement('p');
  explanation.textContent = t('clearExplanation');
  const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'credential-delete'; confirm.textContent = t('confirmDelete');
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = t('cancel');
  const actions = document.createElement('div'); actions.className = 'credential-actions'; actions.append(cancel, confirm);
  dialog.append(heading, explanation, actions);
  open.addEventListener('click', () => { dialog.showModal(); cancel.focus(); });
  cancel.addEventListener('click', () => dialog.close());
  confirm.addEventListener('click', () => {
    dialog.close(); open.disabled = true; status.textContent = t('clearing');
    void (async () => {
      try {
        const result = await transport.sendMessage({ type: 'hidden.clearAll' }) as { ok?: boolean } | null;
        if (result?.ok !== true) throw new Error('Deletion failed');
        status.textContent = t('cleared');
      } catch { status.textContent = t('clearFailure'); }
      finally { open.disabled = false; }
    })();
  });
  section.append(title, note, open, status, dialog); main.append(section);
}
