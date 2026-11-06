import type { runtime } from '../extension-runtime';
import { FILTER_PRESETS, parseThresholdInput } from './threshold';
import { categories, type Values } from './policy';
import { mergeFilterConfig, sameActiveFilter, sameFilterConfig, uniformThresholds, validFilterConfig, type CustomFilter, type FilterConfig, type Preset } from './filter-config';
import { createNotice } from '../ui-notice';
import { FilterSettingsFailure, validFilterFailureReason, type FilterStage } from './settings-failure';
import { t } from '../i18n';
const names = { high: 'strengthHigh', medium: 'strengthMedium', low: 'strengthLow', custom: 'strengthCustom' } as const;
type Choice = keyof typeof names;

export function createFilterSettingsPanel(main: HTMLElement, channel: Pick<typeof runtime, 'sendMessage'>) {
  const section = document.createElement('section'); section.className = 'credential-card filter-card';
  const title = document.createElement('h2'); title.className = 'credential-title'; title.textContent = t('filterTitle');
  const help = document.createElement('p'); help.className = 'credential-help'; help.textContent = t('filterHelp');
  const label = document.createElement('label'); label.className = 'credential-label'; label.htmlFor = 'filter-strength'; label.textContent = t('filterStrength');
  const select = document.createElement('select'); select.id = label.htmlFor; select.className = 'credential-input';
  for (const choice of Object.keys(names) as Choice[]) {
    const option = document.createElement('option'); option.value = choice;
    option.textContent = choice === 'custom' ? t('customOption') : t('presetOption', t(names[choice]), FILTER_PRESETS[choice]); select.append(option);
  }
  select.value = 'medium';
  const details = document.createElement('details'); details.className = 'filter-details';
  const summary = document.createElement('summary'); summary.textContent = t('advancedSettings');
  const presetInfo = document.createElement('p'); presetInfo.className = 'credential-help'; presetInfo.textContent = t('filterPresetInfo');
  const customPanel = document.createElement('div');
  const range = createNotice('credential-help', [t('thresholdRange')], [t('thresholdExtremes')]); range.id = 'filter-threshold-help';
  const field = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = t('customMethod'); field.append(legend);
  function radio(value: 'bulk' | 'individual') {
    const wrapper = document.createElement('label'); const input = document.createElement('input');
    input.type = 'radio'; input.name = 'custom-mode'; input.value = value; input.checked = value === 'bulk';
    wrapper.append(input, document.createTextNode(` ${t(value === 'bulk' ? 'customBulk' : 'customIndividual')}`)); field.append(wrapper, document.createTextNode(' ')); return input;
  }
  const bulkRadio = radio('bulk'); const individualRadio = radio('individual');
  function numberInput(id: string) {
    const input = document.createElement('input'); input.id = id; input.className = 'credential-input'; input.type = 'number';
    input.min = '0'; input.max = '1'; input.step = 'any'; input.required = true; input.setAttribute('aria-describedby', range.id); return input;
  }
  const bulkPanel = document.createElement('div');
  const bulkLabel = document.createElement('label'); bulkLabel.className = 'credential-label'; bulkLabel.htmlFor = 'filter-threshold'; bulkLabel.textContent = t('bulkThreshold');
  const bulkInput = numberInput(bulkLabel.htmlFor); bulkPanel.append(bulkLabel, bulkInput);
  const categoryPanel = document.createElement('div'); const inputs = {} as Record<keyof Values, HTMLInputElement>;
  for (const key of categories) {
    const row = document.createElement('div'); row.className = 'category-row';
    const categoryLabel = document.createElement('label'); categoryLabel.htmlFor = `filter-${key}`; categoryLabel.textContent = t(`category_${key}`);
    const input = numberInput(categoryLabel.htmlFor); inputs[key] = input; row.append(categoryLabel, input); categoryPanel.append(row);
  }
  const modeHelp = document.createElement('p'); modeHelp.className = 'credential-help'; modeHelp.textContent = t('customSaveMode');
  const draftNotice = document.createElement('p'); draftNotice.className = 'credential-help'; draftNotice.setAttribute('aria-live', 'polite');
  const secondDraftNotice = document.createElement('p'); secondDraftNotice.className = 'credential-help'; secondDraftNotice.setAttribute('aria-live', 'polite');
  customPanel.append(range, field, modeHelp, bulkPanel, categoryPanel);
  const burst = createNotice('credential-help', [], [t('thresholdBurst')]); details.append(summary, presetInfo, customPanel, burst);
  const preview = document.createElement('p'); preview.className = 'credential-help'; preview.dataset.testid = 'filter-selection';
  const status = document.createElement('p'); status.dataset.testid = 'filter-status'; status.setAttribute('aria-live', 'polite'); status.textContent = t('filterChecking');
  const save = document.createElement('button'); save.type = 'button'; save.className = 'credential-save'; save.textContent = t('saveFilter');
  const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = t('filterRecheck'); retry.hidden = true;
  const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = t('filterReset'); reset.hidden = true;
  section.append(title, help, label, select, details, draftNotice, secondDraftNotice, preview, status, save, retry, reset, createNotice('credential-help', [], [t('filterApplies'), t('filterNoResend')])); main.append(section);
  let busy = false; let needsVerification = true; let saved: FilterConfig | undefined; let initialCustom: CustomFilter | null = null; let initialized = false; let previous: Preset = 'medium';
  function setDraft(custom: CustomFilter) {
    bulkInput.value = String(custom.bulk); for (const key of categories) inputs[key].value = String(custom.individual[key]);
    bulkRadio.checked = custom.mode === 'bulk'; individualRadio.checked = custom.mode === 'individual'; initialized = true;
    initialCustom = structuredClone(custom);
  }
  function ensureDraft() {
    if (initialized) return;
    const value = FILTER_PRESETS[previous]; setDraft(saved?.custom ?? { mode: 'bulk', bulk: value, individual: uniformThresholds(value) });
  }
  function current(): FilterConfig | undefined {
    const active = select.value as Choice;
    if (active !== 'custom') return { active, custom: saved?.custom ?? null };
    ensureDraft();
    const base = structuredClone(saved?.custom ?? initialCustom!);
    if (bulkRadio.checked) {
      const value = parseThresholdInput(bulkInput.value); if (value === undefined || !bulkInput.validity.valid) return undefined;
      base.mode = 'bulk'; base.bulk = value;
    } else {
      const values = {} as Values;
      for (const key of categories) {
        const value = parseThresholdInput(inputs[key].value); if (value === undefined || !inputs[key].validity.valid) return undefined; values[key] = value;
      }
      base.mode = 'individual'; base.individual = values;
    }
    return { active, custom: base };
  }
  function describe(config: FilterConfig) {
    if (config.active !== 'custom') return t('filterDescribe', t(names[config.active]), FILTER_PRESETS[config.active]);
    return config.custom!.mode === 'bulk' ? t('filterCustomBulkDescription', config.custom!.bulk) : t('filterCustomIndividualDescription');
  }
  function update() {
    const custom = select.value === 'custom'; customPanel.hidden = !custom; presetInfo.hidden = custom;
    bulkPanel.hidden = !bulkRadio.checked; categoryPanel.hidden = !individualRadio.checked;
    const value = current();
    const baseline = saved?.custom ?? initialCustom;
    const bulkDirty = initialized && baseline && parseThresholdInput(bulkInput.value) !== baseline.bulk;
    const individualDirty = initialized && baseline && categories.some(key => parseThresholdInput(inputs[key].value) !== baseline.individual[key]);
    draftNotice.textContent = bulkDirty && (!custom || !bulkRadio.checked) ? t('bulkDraftPending') : '';
    secondDraftNotice.textContent = individualDirty && (!custom || !individualRadio.checked) ? t('individualDraftPending') : '';
    preview.textContent = value ? t('filterSelection', describe(value), t(saved && sameActiveFilter(value, saved) ? 'filterSame' : 'filterUnsaved')) : t('thresholdRangeShort');
  }
  function lock(value: boolean) { busy = value; select.disabled = value; bulkRadio.disabled = value; individualRadio.disabled = value; bulkInput.disabled = value; for (const key of categories) inputs[key].disabled = value; save.disabled = value || needsVerification; retry.disabled = value; reset.disabled = value; }
  async function request(message: { type: string; config?: FilterConfig; expected?: FilterConfig }): Promise<FilterConfig> {
    let response: unknown; try { response = await channel.sendMessage(message); } catch { throw new FilterSettingsFailure('transport'); }
    if (response === undefined || response === null) throw new FilterSettingsFailure('noResponse');
    if (typeof response !== 'object' || Array.isArray(response)) throw new FilterSettingsFailure('invalidShape');
    const result = response as { ok?: unknown; code?: unknown; value?: { config?: unknown } };
    if (result.ok === false) throw new FilterSettingsFailure(validFilterFailureReason(result.code) ? result.code : 'unknownFailureCode');
    if (result.ok !== true || !validFilterConfig(result.value?.config)) throw new FilterSettingsFailure('invalidShape');
    return structuredClone(result.value.config);
  }
  function failure(stage: FilterStage, error: unknown) {
    const code = error instanceof FilterSettingsFailure ? error.code : 'inconsistentResponse';
    needsVerification = true; retry.hidden = false;
    reset.hidden = code !== 'invalidStored';
    status.textContent = code === 'invalidStored' ? t('filterCorrupt') : code === 'conflict' ? t('filterConflict') : t('filterFailure', t(stage === 'initialGet' ? 'filterRetryInitial' : 'filterRetrySave'), `filter-${stage}-${code}`);
  }
  reset.addEventListener('click', () => {
    if (busy || !window.confirm(t('filterResetConfirm'))) return;
    lock(true);
    void request({ type: 'settings.resetInvalidFilter' }).then(config => {
      saved = config; select.value = config.active; initialized = false; initialCustom = null; previous = 'medium';
      needsVerification = false; reset.hidden = true; retry.hidden = true;
      status.textContent = t('filterCurrent', describe(config)); update();
    }).catch(error => failure('save', error)).finally(() => lock(false));
  });
  retry.addEventListener('click', () => {
    if (busy) return; lock(true); status.textContent = t('filterChecking');
    void request({ type: 'settings.getFilterConfig' }).then(config => {
      if (saved && !sameFilterConfig(saved, config) && !window.confirm(t('filterReloadConfirm'))) {
        status.textContent = t('filterRecheckPending'); return;
      }
      if (!saved || !sameFilterConfig(saved, config)) {
        select.value = config.active; if (config.custom) setDraft(config.custom);
        else { initialized = false; initialCustom = null; }
        if (config.active !== 'custom') previous = config.active; else details.open = true;
      }
      saved = config; needsVerification = false; retry.hidden = true; reset.hidden = true;
      status.textContent = t('filterCurrent', describe(config)); update();
    }).catch(error => failure('initialGet', error)).finally(() => lock(false));
  });
  select.addEventListener('change', () => {
    if (select.value === 'custom') { ensureDraft(); details.open = true; } else previous = select.value as Preset;
    update();
  });
  for (const input of [bulkInput, bulkRadio, individualRadio, ...Object.values(inputs)]) input.addEventListener('input', update);
  save.addEventListener('click', () => {
    if (busy || needsVerification || !saved) return; const config = current(); if (!config) { status.textContent = t('thresholdInvalid'); return; }
    const expected = structuredClone(saved); const target = mergeFilterConfig(expected, config);
    lock(true); status.textContent = t('filterSaving');
    void (async () => {
      let stage: FilterStage = 'save';
      try {
        const written = await request({ type: 'settings.saveFilterConfig', config, expected });
        if (!sameFilterConfig(written, target)) throw new FilterSettingsFailure('valueMismatch');
        stage = 'readback'; const readback = await request({ type: 'settings.getFilterConfig' });
        if (!sameFilterConfig(readback, written)) throw new FilterSettingsFailure('valueMismatch');
        saved = readback; needsVerification = false; retry.hidden = true; status.textContent = t('filterSaved', describe(readback)); update();
      } catch (error) { failure(stage, error); } finally { lock(false); }
    })();
  });
  lock(true); customPanel.hidden = true;
  void request({ type: 'settings.getFilterConfig' }).then(config => {
    saved = config; needsVerification = false; select.value = config.active; if (config.custom) setDraft(config.custom);
    if (config.active !== 'custom') previous = config.active; else details.open = true;
    status.textContent = t('filterCurrent', describe(config)); update();
  }).catch(error => failure('initialGet', error)).finally(() => lock(false));
}