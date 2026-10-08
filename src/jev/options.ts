import type { runtime } from '../extension-runtime';
import { DEFAULT_THRESHOLD, FILTER_PRESETS, parseThresholdInput, validThreshold } from './threshold';
import { createNotice } from '../ui-notice';
import { FilterSettingsFailure, validFilterFailureReason, type FilterStage } from './settings-failure';
const names = { high: '高', medium: '中', low: '低', custom: 'カスタム' } as const;
type Choice = keyof typeof names;
function choiceFor(threshold: number): Choice {
  return (Object.keys(FILTER_PRESETS) as (keyof typeof FILTER_PRESETS)[]).find(key => FILTER_PRESETS[key] === threshold) ?? 'custom';
}
function publicThreshold(response: unknown): number {
  if (response === undefined || response === null) throw new FilterSettingsFailure('noResponse');
  const object = typeof response === 'object' && !Array.isArray(response) ? response as Record<string, unknown> : undefined;
  const value = object && typeof object.value === 'object' && object.value !== null && !Array.isArray(object.value)
    ? object.value as Record<string, unknown> : undefined;
  const threshold = value?.threshold;
  const shape = { object: object !== undefined, okTrue: object?.ok === true, okFalse: object?.ok === false,
    valueObject: value !== undefined, thresholdNumber: typeof threshold === 'number', thresholdValid: validThreshold(threshold) };
  if (object?.ok === false) {
    if (validFilterFailureReason(object.code)) throw new FilterSettingsFailure(object.code);
    // Compare only our known historical denial; never render arbitrary response.error/code.
    const legacy = object.code === undefined && object.error === 'この要求は許可されていません。';
    throw new FilterSettingsFailure(legacy ? 'responseDeniedLegacy' : 'unknownFailureCode', shape);
  }
  if (!object || object.ok !== true || !value || !validThreshold(threshold)) throw new FilterSettingsFailure('invalidShape', shape);
  return threshold;
}
export function createFilterSettingsPanel(main: HTMLElement, channel: Pick<typeof runtime, 'sendMessage'>) {
  const section = document.createElement('section'); section.className = 'credential-card filter-card';
  const title = document.createElement('h2'); title.className = 'credential-title'; title.textContent = 'コメントフィルター';
  const help = document.createElement('p'); help.className = 'credential-help';
  help.textContent = '高ほど非表示にしやすく、低ほど慎重に判定します。7項目のいずれかのスコアが判定の基準値以上なら悪質と判定します。';
  const application = createNotice('credential-help', [], [
    '保存後に開始する判定から反映します。判定中・過去の結果や既存の非表示は変更しません。',
    '設定の変更だけでコメントを再送したり、追加のJev通信をしたりすることはありません。',
  ]);
  const label = document.createElement('label'); label.className = 'credential-label'; label.htmlFor = 'filter-strength'; label.textContent = 'フィルターの強さ';
  const select = document.createElement('select'); select.id = label.htmlFor; select.className = 'credential-input';
  for (const choice of Object.keys(names) as Choice[]) {
    const option = document.createElement('option'); option.value = choice;
    option.textContent = choice === 'custom' ? 'カスタム（詳細設定）' : `${names[choice]}（判定の基準値 ${FILTER_PRESETS[choice]}）`;
    select.append(option);
  }
  select.value = 'medium';
  const details = document.createElement('details'); details.className = 'filter-details';
  const summary = document.createElement('summary'); summary.textContent = '詳細設定';
  const customLabel = document.createElement('label'); customLabel.className = 'credential-label'; customLabel.htmlFor = 'filter-threshold'; customLabel.textContent = '判定の基準値';
  const input = document.createElement('input'); input.id = customLabel.htmlFor; input.className = 'credential-input';
  input.type = 'number'; input.min = '0'; input.max = '1'; input.step = 'any'; input.required = true; input.value = String(DEFAULT_THRESHOLD);
  const range = createNotice('credential-help', ['0以上1以下の数値を入力してください。小さいほど非表示にしやすくなります。'], [
    '0では、判定済みのすべてのコメントが悪質になります。1では、スコアが1の項目だけが該当します。',
    '同じ投稿者による10秒以内10件以上の連投は、この値に関係なく非表示の対象です。判定に使う同じ投稿者の直近60秒・最大20件のコメントも変わりません。',
  ]); range.id = 'filter-threshold-help';
  input.setAttribute('aria-describedby', range.id);
  details.append(summary, customLabel, input, range);
  const preview = document.createElement('p'); preview.className = 'credential-help'; preview.dataset.testid = 'filter-selection';
  const status = document.createElement('p'); status.dataset.testid = 'filter-status'; status.setAttribute('aria-live', 'polite'); status.textContent = 'フィルター設定を確認中です。';
  const save = document.createElement('button'); save.type = 'button'; save.className = 'credential-save'; save.textContent = 'フィルター設定を保存';
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
    const next = stage === 'initialGet' ? '画面を開き直すか、保存し直してください。' : 'もう一度保存してください。';
    status.textContent = `フィルター設定の処理に失敗しました。保存状態を確認できません。${next} 確認コード: filter-${stage}-${code}${flags}`;
  }
  function selected() {
    const choice = select.value as Choice;
    return choice === 'custom' ? parseThresholdInput(input.value) : FILTER_PRESETS[choice];
  }
  function describe(threshold: number) { return `${names[choiceFor(threshold)]} / 判定の基準値 ${threshold}`; }
  function previewSelection() {
    const threshold = selected();
    preview.textContent = threshold === undefined ? '0以上1以下の数値を入力してください。'
      : `選択中：${describe(threshold)}${saved === threshold ? '（現在の設定と同じ）' : '（未保存：保存ボタンで反映）'}`;
  }
  function lock(value: boolean) { busy = value; select.disabled = value; input.disabled = value; save.disabled = value; }
  function render(threshold: number) {
    saved = threshold; select.value = choiceFor(threshold); input.value = String(threshold);
    details.open = select.value === 'custom'; status.textContent = `現在の設定：${describe(threshold)}`; previewSelection();
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
      status.textContent = '判定の基準値は0以上1以下の数値を入力してください。保存していません。'; return;
    }
    lock(true); status.textContent = 'フィルター設定を保存・確認中です。';
    void (async () => {
      let stage: FilterStage = 'save';
      try {
        const written = await requestThreshold({ type: 'settings.saveFilter', threshold });
        if (written !== threshold) throw new FilterSettingsFailure('valueMismatch');
        stage = 'readback';
        const readback = await requestThreshold({ type: 'settings.getFilter' });
        if (readback !== threshold) throw new FilterSettingsFailure('valueMismatch');
        render(threshold);
        status.textContent = `保存しました：${describe(threshold)}`;
      } catch (error) { failure(stage, error); }
      finally { lock(false); }
    })();
  });
  lock(true); previewSelection();
  void requestThreshold({ type: 'settings.getFilter' }).then(render)
    .catch(error => failure('initialGet', error))
    .finally(() => lock(false));
}
