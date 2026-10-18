import type { createModerationTransport } from './runtime-transport';
import { categories } from './policy';
import type { JevError } from './contracts';
import { createTransientMap, MAX_PENDING_EVALUATIONS, TRANSIENT_TTL_MILLIS } from '../retention';
import { createNotice } from '../ui-notice';
import { t } from '../i18n';
const failure = (code: JevError['code']) => t(code === 'confirmationRequired' ? 'confirmationRequired' : `jev_${code}`);
export function createJevPanel(main: HTMLElement, transport: ReturnType<typeof createModerationTransport>) {
  const section = document.createElement('section');
  section.className = 'jev-controls';
  const notice = createNotice('monitor-note', [
    t('jevDisclosure'),
    t('jevAgreement'),
  ], [
    t('jevScope'),
    t('jevSingleRequest'),
    t('jevHiding'),
    t('burstDisclosure'),
  ]);
  const enable = document.createElement('button'); enable.textContent = t('enableJev'); enable.disabled = true;
  const disable = document.createElement('button'); disable.textContent = t('disableJev'); disable.disabled = true;
  enable.type = 'button'; disable.type = 'button';
  const status = document.createElement('p'); status.dataset.testid = 'jev-status'; status.setAttribute('aria-live', 'polite'); status.textContent = t('jevNotEnabled');
  const actions = document.createElement('div'); actions.className = 'monitor-actions'; actions.append(enable, disable);
  section.append(actions, status, notice); main.append(section);
  let generation = 0;
  let enabled = false;
  let valid = false;
  let enabling = false;
  type Job = { key: string; item: HTMLElement; label: HTMLElement; run(): Promise<void> };
  let sequence = 0;
  let busy = false;
  const pending = new Set<HTMLElement>();
  const waiting = createTransientMap<Job>({ limit: MAX_PENDING_EVALUATIONS, onDelete(_id, job) {
    if (pending.delete(job.label)) job.label.textContent = t('unjudgedLimit');
  } });
  function drain() {
    if (busy) return;
    const job = waiting.values()[0];
    if (!job) return;
    pending.delete(job.label); waiting.delete(job.key); pending.add(job.label);
    busy = true;
    void job.run().catch(() => { job.label.textContent = t('unjudgedInterrupted'); }).finally(() => {
      pending.delete(job.label); busy = false; drain();
    });
  }
  function buttons() { enable.disabled = !valid || enabling || enabled; disable.disabled = !enabled && !enabling; }
  function stop(message = t('jevStopped'), collection = false) {
    generation++; enabled = false; enabling = false; status.textContent = message; buttons();
    for (const label of pending) label.textContent = t('unjudgedStopped');
    pending.clear(); waiting.clear(); void transport.stop(collection);
  }
  enable.addEventListener('click', () => {
    if (enabling || enabled || !valid) return;
    const current = generation; enabling = true; buttons();
    void transport.enable().then(result => {
      if (current !== generation) return;
      enabling = false; enabled = result.ok;
      status.textContent = result.ok ? t('jevEnabled') : t('transmissionStopped', failure(result.error.code));
      buttons();
    });
  });
  disable.addEventListener('click', () => stop());
  function add(id: string, author: string, item: HTMLElement) {
    const display = document.createElement('div'); display.className = 'chat-moderation';
    const label = document.createElement('span'); label.className = 'moderation-status'; label.textContent = t('unjudged');
    display.append(label); item.append(display); pending.add(label);
    const current = generation;
    const expires = Date.now() + TRANSIENT_TTL_MILLIS;
    const key = String(++sequence);
    const job: Job = { key, item, label, async run() {
      if (current !== generation) return;
      const result = await transport.evaluate(id, author);
      if (current !== generation) return;
      pending.delete(label);
      if (result?.jev === 'failed') { enabled = false; status.textContent = t('evaluationStopped', failure(result.error!.code)); buttons(); }
      if (Date.now() >= expires) { label.textContent = t('unjudgedTimeout'); return; }
      if (!item.isConnected) return;
      if (!result) { label.textContent = t('unjudgedMissing'); return; }
      const outcome = result.malicious === true ? t('malicious', result.reasons.map(reason => t(reason === 'burst' ? 'burstReason' : `category_${reason}`)).join(t('reasonSeparator')))
        : t(result.malicious === false ? 'noMatch' : 'unjudged');

      const time = result.burst === 'unavailable' ? t('burstUnavailable') : '';
      const jev = result.jev === 'failed' ? t('jevFailedResult', failure(result.error!.code))
        : result.jev === 'disabled' ? t('jevDisabledResult') : result.jev === 'unjudged' ? t('jevUnjudgedResult') : t('jevEvaluatedResult', String(result.threshold));
      label.textContent = `${outcome}${jev}${time}`;
      if (result.malicious === true) label.classList.add('is-malicious');
      if (result.evaluation) {
        const badge = document.createElement('span'); badge.className = 'score-badge';
        badge.textContent = t('scoreBadge', Math.max(...categories.map(key => result.evaluation!.values[key])).toFixed(2));
        const details = document.createElement('details'); details.className = 'score-details';
        const summary = document.createElement('summary'); summary.textContent = t('categoryScores');
        const values = document.createElement('dl');
        for (const key of categories) {
          const name = document.createElement('dt'); name.textContent = t(`category_${key}`);
          const value = document.createElement('dd'); value.textContent = String(result.evaluation.values[key]);
          values.append(name, value);
        }
        details.append(summary, values); display.append(badge, details);
      }

    } };
    if (!waiting.set(key, job)) {
      pending.delete(label); label.textContent = t('unjudgedQueueFull');
      status.textContent = t('queueFull');
      return;
    }
    drain();
  }
  function remove(item: HTMLElement) {
    for (const job of waiting.values()) if (job.item === item) waiting.delete(job.key);
    for (const label of pending) if (item.contains(label)) pending.delete(label);
    // A single in-flight evaluation may still reference this row, but not its old body.
    item.replaceChildren(); item.remove();
  }
  return { add, remove, stop, setTarget(available: boolean) { valid = available; buttons(); } };
}
