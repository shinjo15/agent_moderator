import type { runtime } from '../extension-runtime';
import { DEFAULT_THRESHOLD, FILTER_PRESETS, parseThresholdInput, validThreshold } from './threshold';
import { createNotice } from '../ui-notice';
import { FilterSettingsFailure, publicThreshold, type FilterStage } from './settings-failure';
import { t } from '../i18n';
const names = { high: 'strengthHigh', medium: 'strengthMedium', low: 'strengthLow', custom: 'strengthCustom' } as const;
type Choice = keyof typeof names;
function choiceFor(threshold: number): Choice {
  return (Object.keys(FILTER_PRESETS) as (keyof typeof FILTER_PRESETS)[]).find(key => FILTER_PRESETS[key] === threshold) ?? 'custom';
}
export function createFilterSettingsPanel(main: HTMLElement, channel: Pick<typeof runtime, 'sendMessage'>) {
  const section = document.createElement('section'); section.className = 'credential-card filter-card';
  const title = document.createElement('h2'); title.className = 'credential-title'; title.textContent = t('filterTitle');
  const help = document.createElement('p'); help.className = 'credential-help';
  help.textContent = t('filterHelp');
  const application = createNotice('credential-help', [], [
    t('filterApplies'),
    t('filterNoResend'),
  ]);
  const label = document.createElement('label'); label.className = 'credential-label'; label.htmlFor = 'filter-strength'; label.textContent = t('filterStrength');
  const select = document.createElement('select'); select.id = label.htmlFor; select.className = 'credential-input';
  for (const choice of Object.keys(names) as Choice[]) {
    const option = document.createElement('option'); option.value = choice;
    option.textContent = choice === 'custom' ? t('customOption') : t('presetOption', t(names[choice]), FILTER_PRESETS[choice]);
    select.append(option);
  }
  select.value = 'medium';
  const details = document.createElement('details'); details.className = 'filter-details';
  const summary = document.createElement('summary'); summary.textContent = t('advancedSettings');
  const customLabel = document.createElement('label'); customLabel.className = 'credential-label'; customLabel.htmlFor = 'filter-threshold'; customLabel.textContent = t('threshold');
  const input = document.createElement('input'); input.id = customLabel.htmlFor; input.className = 'credential-input';
  input.type = 'number'; input.min = '0'; input.max = '1'; input.step = 'any'; input.required = true; input.value = String(DEFAULT_THRESHOLD);
  const range = createNotice('credential-help', [t('thresholdRange')], [
    t('thresholdExtremes'),
    t('thresholdBurst'),
  ]); range.id = 'filter-threshold-help';
  input.setAttribute('aria-describedby', range.id);
  details.append(summary, customLabel, input, range);
  const preview = document.createElement('p'); preview.className = 'credential-help'; preview.dataset.testid = 'filter-selection';
  const status = document.createElement('p'); status.dataset.testid = 'filter-status'; status.setAttribute('aria-live', 'polite'); status.textContent = t('filterChecking');
  const save = document.createElement('button'); save.type = 'button'; save.className = 'credential-save'; save.textContent = t('saveFilter');
  section.append(title, help, label, select, details, preview, status, save, application); main.append(section);
  let busy = false;
  let saved: number | undefined;
  async function requestThreshold(message: { type: string; threshold?: number }) {
    let response: unknown;
    try { response = await channel.sendMessage(message); }
    catch { throw new FilterSettingsFailure('transport'); }
    return publicThreshold(response);
  }
  function failure(stage: FilterStage, error: unknown) {
    const code = error instanceof FilterSettingsFailure ? error.code : 'inconsistentResponse';
    const shape = error instanceof FilterSettingsFailure ? error.shape : undefined;
    const flags = shape ? ` shape:${[shape.object, shape.okTrue, shape.okFalse, shape.valueObject, shape.thresholdNumber, shape.thresholdValid].map(flag => flag ? '1' : '0').join('')}` : '';
    const next = t(stage === 'initialGet' ? 'filterRetryInitial' : 'filterRetrySave');
    status.textContent = t('filterFailure', next, `filter-${stage}-${code}${flags}`);
  }
  function selected() {
    const choice = select.value as Choice;
    return choice === 'custom' ? parseThresholdInput(input.value) : FILTER_PRESETS[choice];
  }
  function describe(threshold: number) { return t('filterDescribe', t(names[choiceFor(threshold)]), threshold); }
  function previewSelection() {
    const threshold = selected();
    preview.textContent = threshold === undefined ? t('thresholdRangeShort')
      : t('filterSelection', describe(threshold), t(saved === threshold ? 'filterSame' : 'filterUnsaved'));
  }
  function lock(value: boolean) { busy = value; select.disabled = value; input.disabled = value; save.disabled = value; }
  function render(threshold: number) {
    saved = threshold; select.value = choiceFor(threshold); input.value = String(threshold);
    details.open = select.value === 'custom'; status.textContent = t('filterCurrent', describe(threshold)); previewSelection();
  }
  select.addEventListener('change', () => {
    if (select.value === 'custom') details.open = true;
    else input.value = String(FILTER_PRESETS[select.value as keyof typeof FILTER_PRESETS]);
    previewSelection();
  });
  input.addEventListener('input', () => { select.value = 'custom'; previewSelection(); });
  save.addEventListener('click', () => {
    if (busy) return;
    const threshold = selected();
    if (!validThreshold(threshold) || (select.value === 'custom' && !input.validity.valid)) {
      status.textContent = t('thresholdInvalid'); return;
    }
    lock(true); status.textContent = t('filterSaving');
    void (async () => {
      let stage: FilterStage = 'save';
      try {
        const written = await requestThreshold({ type: 'settings.saveFilter', threshold });
        if (written !== threshold) throw new FilterSettingsFailure('valueMismatch');
        stage = 'readback';
        const readback = await requestThreshold({ type: 'settings.getFilter' });
        if (readback !== threshold) throw new FilterSettingsFailure('valueMismatch');
        render(threshold);
        status.textContent = t('filterSaved', describe(threshold));
      } catch (error) { failure(stage, error); }
      finally { lock(false); }
    })();
  });
  lock(true); previewSelection();
  void requestThreshold({ type: 'settings.getFilter' }).then(render)
    .catch(error => failure('initialGet', error))
    .finally(() => lock(false));
}
