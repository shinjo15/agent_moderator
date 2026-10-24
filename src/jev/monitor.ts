import type { createModerationTransport } from './runtime-transport';
import { categories } from './policy';
import type { JevError } from './contracts';
import { createTransientMap, MAX_PENDING_EVALUATIONS, TRANSIENT_TTL_MILLIS } from '../retention';
import { createNotice } from '../ui-notice';
import { t } from '../i18n';
const failure = (code: JevError['code']) => t(code === 'confirmationRequired' ? 'confirmationRequired' : `jev_${code}`);
export function createJevPanel(main: HTMLElement, transport: ReturnType<typeof createModerationTransport>, evaluated: () => void = () => {}) {
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
  type Job = { key: string; item: HTMLElement; expires: number; update(message: string, compact: string): void; run(): Promise<void> };
  let sequence = 0;
  let busy = false;
  const pending = new Set<Job>();
  const waiting = createTransientMap<Job>({ limit: MAX_PENDING_EVALUATIONS, onDelete(_id, job) {
    if (pending.delete(job)) job.update(t('unjudgedLimit'), t('evaluationLimit'));
  } });
  function drain() {
    if (busy) return;
    const job = waiting.values()[0];
    if (!job) return;
    pending.delete(job); waiting.delete(job.key); pending.add(job);
    busy = true;
    const timer = setTimeout(() => {
      if (pending.has(job)) job.update(t('unjudgedTimeout'), t('evaluationExpired'));
    }, Math.max(1, job.expires - Date.now() + 1));
    void job.run().catch(() => {
      if (pending.has(job)) job.update(t('unjudgedInterrupted'), t('evaluationInterrupted'));
    }).finally(() => {
      clearTimeout(timer);
      pending.delete(job); busy = false; drain();
    });
  }
  function buttons() { enable.disabled = !valid || enabling || enabled; disable.disabled = !enabled && !enabling; }
  function stop(message = t('jevStopped'), collection = false) {
    generation++; enabled = false; enabling = false; status.textContent = message; buttons();
    for (const job of pending) job.update(t('unjudgedStopped'), t('evaluationStoppedSummary'));
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
    const detail = document.createElement('details'); detail.className = 'message-details';
    const summary = document.createElement('summary'); summary.textContent = t('commentDetails');
    detail.append(summary);
    const authorDetail = item.querySelector('.author-details'); if (authorDetail) detail.append(authorDetail);
    const display = document.createElement('div'); display.className = 'chat-moderation';
    const label = document.createElement('span'); label.className = 'moderation-status'; label.textContent = t('unjudged');
    const compact = document.createElement('span'); compact.className = 'score-badge evaluation-summary'; compact.setAttribute('role', 'img');
    display.append(label); detail.append(display); item.append(compact, detail);
    function update(message: string, short: string, state = 'neutral', score?: string) {
      label.textContent = message;
      compact.dataset.state = state;
      compact.textContent = state === 'bad' ? `× ${score ?? '—'}` : state === 'good' ? `✓ ${score ?? '—'}`
        : short === t('evaluationInProgress') ? '…' : short === t('evaluationFailed') ? '!' : '—';
      const description = `${short}: ${message}${score === undefined ? '' : ` / ${t('scoreBadge', score)}`}`;
      compact.title = description; compact.setAttribute('aria-label', description);
    }
    update(t('unjudged'), t('unjudged'));
    const current = generation;
    const eligible = enabled;
    const expires = Date.now() + TRANSIENT_TTL_MILLIS;
    const key = String(++sequence);
    const job: Job = { key, item, expires, update, async run() {
      if (current !== generation) return;
      if (eligible && enabled) update(t('evaluationInProgressDetail'), t('evaluationInProgress'));
      const result = await transport.evaluate(id, author);
      if (current !== generation) return;
      evaluated();
      pending.delete(job);
      if (result?.jev === 'failed') { enabled = false; status.textContent = t('evaluationStopped', failure(result.error!.code)); buttons(); }
      if (Date.now() >= expires) { update(t('unjudgedTimeout'), t('evaluationExpired')); return; }
      if (!item.parentNode) return;
      if (!result) { update(t('unjudgedMissing'), t('evaluationInterrupted')); return; }
      const outcome = result.malicious === true ? t('malicious', result.reasons.map(reason => t(reason === 'burst' ? 'burstReason' : `category_${reason}`)).join(t('reasonSeparator')))
        : t(result.malicious === false ? 'noMatch' : 'unjudged');

      const time = result.burst === 'unavailable' ? t('burstUnavailable') : '';
      const jev = result.jev === 'failed' ? t('jevFailedResult', failure(result.error!.code))
        : result.jev === 'disabled' ? t('jevDisabledResult') : result.jev === 'unjudged' ? t('jevUnjudgedResult') : t('jevEvaluatedResult', String(result.threshold));
      const score = result.jev === 'evaluated' && result.evaluation
        ? Math.max(...categories.map(key => result.evaluation!.values[key])).toFixed(2) : undefined;
      update(`${outcome}${jev}${time}`, t(result.jev === 'evaluated' ? 'evaluationComplete'
        : result.jev === 'failed' ? 'evaluationFailed' : result.burst === 'confirmed' ? 'evaluationBurstOnly' : 'unjudged'),
      result.malicious === true ? 'bad' : result.jev === 'evaluated' && result.malicious === false ? 'good' : 'neutral', score);
      if (result.malicious === true) label.classList.add('is-malicious');
      if (result.evaluation) {
        const details = document.createElement('details'); details.className = 'score-details';
        const summary = document.createElement('summary'); summary.textContent = t('categoryScores');
        const values = document.createElement('dl');
        for (const key of categories) {
          const name = document.createElement('dt'); name.textContent = t(`category_${key}`);
          const value = document.createElement('dd'); value.textContent = String(result.evaluation.values[key]);
          values.append(name, value);
        }
        details.append(summary, values); display.append(details);
      }

    } };
    pending.add(job);
    if (!waiting.set(key, job)) {
      pending.delete(job); update(t('unjudgedQueueFull'), t('evaluationLimit'));
      status.textContent = t('queueFull');
      return;
    }
    drain();
  }
  function remove(item: HTMLElement) {
    for (const job of waiting.values()) if (job.item === item) waiting.delete(job.key);
    for (const job of pending) if (job.item === item) pending.delete(job);
    // A single in-flight evaluation may still reference this row, but not its old body.
    item.replaceChildren(); item.remove();
  }
  return { add, remove, stop,
    resetTarget() {
      generation++; enabled = false; enabling = false; valid = false;
      pending.clear(); waiting.clear(); status.textContent = t('jevNotEnabled'); buttons();
    },
    resolved(active: boolean) { enabled = active; enabling = false; status.textContent = t(active ? 'jevEnabled' : 'jevNotEnabled'); buttons(); },
    setTarget(available: boolean) { valid = available; buttons(); } };
}
