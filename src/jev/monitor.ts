import type { createModerationTransport } from './runtime-transport';
import { categories, definitions, type Category } from './policy';
import type { JevError } from './contracts';
import { createTransientMap, MAX_PENDING_EVALUATIONS, TRANSIENT_TTL_MILLIS } from '../retention';
import { createNotice } from '../ui-notice';
import { confirmationRequired } from '../confirmation';
const failures: Record<JevError['code'], string> = {
  confirmationRequired,
  missingKey: '設定でJev APIキーを保存してください。', auth: 'Jev APIキーの認証に失敗しました。設定でキーを確認し、保存し直してください。', validation: 'Jevに判定を依頼できませんでした。時間をおいて再開し、問題が続く場合は拡張機能の更新を確認してください。',
  rateLimited: 'Jevの利用制限です。時間をおいて再開ボタンを押してください。', overloaded: 'Jevが混雑しています。時間をおいて再開ボタンを押してください。',
  network: 'Jevとの通信に失敗しました。接続を確認し、再開ボタンを押してください。', invalidResponse: 'Jevの判定結果を確認できませんでした。時間をおいて再開ボタンを押してください。', aborted: 'Jev判定を停止しました。再開ボタンを押してください。', api: 'Jev判定に失敗しました。時間をおいて再開ボタンを押してください。',
};
export function createJevPanel(main: HTMLElement, transport: ReturnType<typeof createModerationTransport>) {
  const section = document.createElement('section');
  section.className = 'jev-controls';
  const notice = createNotice('monitor-note', [
    'Jev判定を有効にすると、悪質性の判定のためコメントの本文と投稿時刻をTypeSafe AIへ送信します。同じ投稿者の60秒以内・対象を含め最大20件です。利用料金は利用者負担です。',
    '設定で利用規約案・プライバシーポリシー案とデータの扱いに同意する前は送信しません。利用者の同意は投稿者本人の同意ではありません。',
  ], [
    '有効にした後に取得するコメントだけを判定します。同じ投稿者の直近60秒以内・対象を含め最大20件の本文と投稿時刻のみを送信します。投稿者ID・他の投稿者のコメント・APIキーは投稿データに含めません。',
    '1件につき7項目を1回の通信で判定します。失敗しても自動では再送しません。',
    '悪質と判定した投稿者を、この配信のあなたの画面だけで非表示にします。YouTube上のBANやコメント削除はしません。',
    '同じ投稿者の10秒以内10件以上の連投は、取得した投稿時刻を使い、この拡張機能で判定します。',
  ]);
  const enable = document.createElement('button'); enable.textContent = 'Jev判定を有効化・再開'; enable.disabled = true;
  const disable = document.createElement('button'); disable.textContent = 'Jev判定を停止'; disable.disabled = true;
  enable.type = 'button'; disable.type = 'button';
  const status = document.createElement('p'); status.dataset.testid = 'jev-status'; status.setAttribute('aria-live', 'polite'); status.textContent = 'Jev未有効化：外部送信しません。';
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
    if (pending.delete(job.label)) job.label.textContent = '未判定：判定の待ち時間や表示件数の上限を超えました。';
  } });
  function drain() {
    if (busy) return;
    const job = waiting.values()[0];
    if (!job) return;
    pending.delete(job.label); waiting.delete(job.key); pending.add(job.label);
    busy = true;
    void job.run().catch(() => { job.label.textContent = '未判定：判定中断'; }).finally(() => {
      pending.delete(job.label); busy = false; drain();
    });
  }
  function buttons() { enable.disabled = !valid || enabling || enabled; disable.disabled = !enabled && !enabling; }
  function stop(message = 'Jev判定を停止しました。再開するには「Jev判定を有効化・再開」を押してください。', collection = false) {
    generation++; enabled = false; enabling = false; status.textContent = message; buttons();
    for (const label of pending) label.textContent = '未判定：停止しました。';
    pending.clear(); waiting.clear(); void transport.stop(collection);
  }
  enable.addEventListener('click', () => {
    if (enabling || enabled || !valid) return;
    const current = generation; enabling = true; buttons();
    void transport.enable().then(result => {
      if (current !== generation) return;
      enabling = false; enabled = result.ok;
      status.textContent = result.ok ? 'Jev判定が有効です。新着を順に評価します。' : `${failures[result.error.code]} 外部送信を停止しています。`;
      buttons();
    });
  });
  disable.addEventListener('click', () => stop());
  function add(id: string, author: string, item: HTMLElement) {
    const display = document.createElement('div'); display.className = 'chat-moderation';
    const label = document.createElement('span'); label.className = 'moderation-status'; label.textContent = '未判定';
    display.append(label); item.append(display); pending.add(label);
    const current = generation;
    const expires = Date.now() + TRANSIENT_TTL_MILLIS;
    const key = String(++sequence);
    const job: Job = { key, item, label, async run() {
      if (current !== generation) return;
      const result = await transport.evaluate(id, author);
      if (current !== generation) return;
      pending.delete(label);
      if (result?.jev === 'failed') { enabled = false; status.textContent = `${failures[result.error!.code]} 判定を停止しています。自動では再開しません。`; buttons(); }
      if (Date.now() >= expires) { label.textContent = '未判定：判定の待ち時間を超えました。'; return; }
      if (!item.isConnected) return;
      if (!result) { label.textContent = '未判定：必要なコメントを確認できないか、判定が中断されました。'; return; }
      const outcome = result.malicious === true ? `悪質（${result.reasons.map(reason => reason === 'burst' ? '10秒以内10件以上の連投' : definitions[reason as Category]).join('、')}）`
        : result.malicious === false ? '該当なし' : '未判定';

      const time = result.burst === 'unavailable' ? ' / 投稿時刻を確認できないため、連投は判定できません' : '';
      const jev = result.jev === 'failed' ? ` / Jev判定失敗: ${failures[result.error!.code]}`
        : result.jev === 'disabled' ? ' / Jev判定は未開始・停止中' : result.jev === 'unjudged' ? ' / Jev判定は未実施' : ` / Jev判定済み（判定の基準値 ${result.threshold}）`;
      label.textContent = `${outcome}${jev}${time}`;
      if (result.malicious === true) label.classList.add('is-malicious');
      if (result.evaluation) {
        const badge = document.createElement('span'); badge.className = 'score-badge';
        badge.textContent = `判定スコア ${Math.max(...categories.map(key => result.evaluation!.values[key])).toFixed(2)}`;
        const details = document.createElement('details'); details.className = 'score-details';
        const summary = document.createElement('summary'); summary.textContent = '項目別スコア';
        const values = document.createElement('dl');
        for (const key of categories) {
          const name = document.createElement('dt'); name.textContent = definitions[key];
          const value = document.createElement('dd'); value.textContent = String(result.evaluation.values[key]);
          values.append(name, value);
        }
        details.append(summary, values); display.append(badge, details);
      }

    } };
    if (!waiting.set(key, job)) {
      pending.delete(label); label.textContent = '未判定：コメントが多く、判定待ちの上限を超えました。';
      status.textContent = 'コメントが多く、一部を判定できません。未判定のコメントは「該当なし」ではありません。';
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
