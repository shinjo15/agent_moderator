import type { createModerationTransport } from './runtime-transport';
import { definitions, type Category } from './policy';
import type { JevError } from './contracts';
const failures: Record<JevError['code'], string> = {
  missingKey: 'Jevキーを設定してください。', auth: 'Jevキーの認証に失敗しました。', validation: 'Jevが要求を受け付けませんでした。',
  rateLimited: 'Jevの利用制限です。指定待機時間後に明示再開してください。', overloaded: 'Jevが混雑しています。指定待機時間後に明示再開してください。',
  network: 'Jevとの通信に失敗しました。', invalidResponse: 'Jevの応答が不正です。', aborted: 'Jev判定を停止しました。', api: 'Jev判定に失敗しました。',
};
export function createJevPanel(main: HTMLElement, transport: ReturnType<typeof createModerationTransport>) {
  const section = document.createElement('section');
  const notice = document.createElement('p');
  notice.textContent = 'Jev判定は明示有効化した後の新着のみ。取得済みの同一投稿者の直近60秒以内、対象を含め最大20件の本文と投稿時刻のみをJevへ送信します。ID・他の投稿者・キーは投稿データに含めません。Jev利用料は利用者負担です。1件ずつ全項目を1回で評価し、自動再試行しません。悪質と確定した投稿者をこの配信でローカル非表示にします。BAN・投稿削除は行いません。連投は取得済み投稿時刻からアプリで判定します。';
  const enable = document.createElement('button'); enable.textContent = 'Jev判定を有効化・再開'; enable.disabled = true;
  const disable = document.createElement('button'); disable.textContent = 'Jev判定を停止'; disable.disabled = true;
  const status = document.createElement('p'); status.dataset.testid = 'jev-status'; status.setAttribute('aria-live', 'polite'); status.textContent = 'Jev未有効化：外部送信しません。';
  section.append(notice, enable, disable, status); main.append(section);
  let generation = 0;
  let enabled = false;
  let valid = false;
  let enabling = false;
  let queue: Promise<void> = Promise.resolve();
  const pending = new Set<HTMLElement>();
  function buttons() { enable.disabled = !valid || enabling || enabled; disable.disabled = !enabled && !enabling; }
  function stop(message = 'Jev判定を停止しました。明示的に有効化・再開してください。', collection = false) {
    generation++; enabled = false; enabling = false; status.textContent = message; buttons();
    for (const label of pending) label.textContent = ' — 未判定：停止しました。';
    pending.clear(); void transport.stop(collection);
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
    const label = document.createElement('span'); label.textContent = ' — 未判定'; item.append(label); pending.add(label);
    const current = generation;
    queue = queue.then(async () => {
      if (current !== generation) return;
      const result = await transport.evaluate(id, author);
      if (current !== generation) return;
      pending.delete(label);
      if (!result) { label.textContent = ' — 未判定：対象・履歴なし、または判定中断'; return; }
      const outcome = result.malicious === true ? `悪質（${result.reasons.map(reason => reason === 'burst' ? '10秒以内10件以上の連投' : definitions[reason as Category]).join('、')}）`
        : result.malicious === false ? '該当なし' : '未判定';
      const values = result.evaluation ? ` / 項目評価: ${Object.entries(result.evaluation.values).map(([key, value]) => `${definitions[key as Category]}=${value}`).join('、')}` : '';
      const time = result.burst === 'unavailable' ? ' / 投稿時刻の条件は判定不能' : '';
      const jev = result.jev === 'failed' ? ` / Jev判定失敗: ${failures[result.error!.code]}`
        : result.jev === 'disabled' ? ' / Jev未有効化・停止中' : result.jev === 'unjudged' ? ' / Jev未判定：履歴保持窓外またはローカル連投確定' : ' / Jev判定済み';
      label.textContent = ` — ${outcome}${jev}${time}${values}`;
      if (result.jev === 'failed') { enabled = false; status.textContent = `${failures[result.error!.code]} Jev通信を停止しました。明示再開が必要です。`; buttons(); }

    });
  }
  return { add, stop, setTarget(available: boolean) { valid = available; buttons(); } };
}
