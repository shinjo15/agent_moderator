import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, it } from 'vitest';

const policyPath = 'docs/privacy.md';
const policy = () => readFileSync(policyPath, 'utf8');

it('一般利用者向けの日本語ポリシー案は更新日と未確定の施行日を区別する', () => {
  const text = policy();
  expect(text).toContain('# プライバシーポリシー（案）');
  expect(text).toMatch(/最終更新日：\d{4}-\d{2}-\d{2}（日本時間）/);
  expect(text).toContain('施行日：未定');
  expect(text).toContain('未公開');
  expect(text).not.toContain('Issue #5統合済み');
});

it('YouTube API Servicesの使用、利用規約への拘束、GoogleとTypeSafeのprivacyリンクを開示する', () => {
  const text = policy();
  expect(text).toContain('YouTube API Services');
  expect(text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')).toContain('利用規約に拘束されます');
  for (const url of [
    'https://www.youtube.com/t/terms',
    'https://policies.google.com/privacy',
    'https://typesafe.ai/legal/privacy-policy',
  ]) expect(text).toContain(url);
});

it('実装のlocal保存対象と期限なしの非表示情報・解除後の残存を開示する', () => {
  const text = policy();
  for (const token of ['chrome.storage.local', 'moderation.threshold', 'hiddenAuthors.', 'displayNames', 'revisions']) {
    expect(text).toContain(token);
  }
  expect(text).toContain('自動期限はありません');
  expect(text).toContain('解除後も');
  expect(text).toContain('投稿者名');
  expect(text).toContain('Chrome同期');
  expect(text).toContain('独自暗号化は実装していません');
});

it('Jevのstateと認証キー・本文の個人情報、保持と学習の未知部分を区別する', () => {
  const text = policy();
  expect(text).toContain('本文と投稿時刻');
  expect(text).toContain('同じ投稿者');
  expect(text).toContain('60秒以内');
  expect(text).toContain('対象を含め最大20件');
  expect(text).toContain('Authorization');
  expect(text).toContain('自動マスキングは実装していません');
  expect(text).toContain('投稿者本人の同意');
  expect(text).toContain('事前同意');
  expect(text).toContain('保持期間');
  expect(text).toContain('未確認');
  expect(text).toContain('ゼロ保持');
});

it('session制御と一時保持・画面表示の異なる寿命を開示する', () => {
  const text = policy();
  expect(text).toContain('chrome.storage.session');
  expect(text).toContain('タブ');
  expect(text).toContain('待機');
  expect(text).toContain('60秒');
  expect(text).toContain('200件');
  expect(text).toContain('画面表示');
  expect(text).toContain('閉じる');
});

it('停止・個別解除・キー削除・拡張削除と提供元の処理を独立して説明する', () => {
  const text = policy();
  for (const action of ['Jev判定を停止', '取得を停止', '非表示を解除', 'YouTubeキーを削除', 'Jevキーを削除', 'chrome://extensions', 'アンインストール']) {
    expect(text).toContain(action);
  }
  expect(text).toContain('全配信の非表示データを削除');
  expect(text).toContain('APIの待機期限');
  expect(text).toContain('空の保存項目');
  expect(text).toContain('削除を確認できない');
  expect(text).not.toContain('一括消去ボタンはありません');
  expect(text).toContain('遠隔削除');
  expect(text).toContain('送信済み');
  expect(text).toContain('失効');
});

it('承認された問い合わせ先と削除要求・操作支援の限界を案内する', () => {
  const text = policy();
  expect(text).toContain('[shinjo0015@gmail.com](mailto:shinjo0015@gmail.com)');
  expect(text).toContain('削除要求');
  expect(text).toContain('操作を案内');
  expect(text).toContain('APIキーを送らない');
});

it('公開前の未達auditを利用者向けpolicyから分離し、両文書のローカルリンクが存在する', () => {
  const readiness = 'docs/release-preparation/privacy-readiness.md';
  expect(policy()).toContain('](release-preparation/privacy-readiness.md)');
  expect(existsSync(readiness)).toBe(true);
  const audit = readFileSync(readiness, 'utf8');
  expect(audit).toContain('未公開');
  expect(audit).toContain('30日');
  expect(audit).toContain('同意');
  expect(audit).toContain('Limited Use');
  expect(audit).toContain('コード');
  const jev = audit.split('\n').find(line => line.startsWith('- Jev：'))!;
  for (const token of ['固定HTTPS', 'Authorizationヘッダー', 'Bearer認証', 'state', '本文と任意の投稿時刻のみ', 'src/jev/client.ts:13-17', 'src/jev/history.ts:6-7,27-33']) {
    expect(jev).toContain(token);
  }
  expect(audit).not.toContain('Bearer...33');
  expect(audit).not.toContain('問い合わせ文案（未送信）');
  expect(audit).toContain('ユーザーはTypeSafeへ送信済み');
  expect(audit).toContain('本作業では問い合わせを送信していない');
  for (const path of [policyPath, readiness]) {
    for (const match of readFileSync(path, 'utf8').matchAll(/\]\(([^\s)]+)\)/g)) {
      const target = match[1];
      if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('#')) continue;
      expect(existsSync(resolve(dirname(path), target.split('#')[0])), target).toBe(true);
    }
  }
});
