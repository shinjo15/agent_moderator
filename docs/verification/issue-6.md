# Issue #6：文書と#5統合検証境界

## 当初の独立作業（履歴）

- 作業：shinjo15/agent_moderator Issue #6のみ。
- 当初のbase：`f12b14b`（Issue #4まで）。以下の独立作業時の実測値は#5を含まない。今回の統合対象は#5 commit `221954f` を取り込んだ#6 docs commit上であり、#5の別worktreeは編集していない。
- WSL、Node.js v26.7.0、npm 11.19.0。2026-10-05に実行。
- 実キー・`.env`・実利用者のブラウザprofileは読まない。テストは架空キーとAPI fixture、一時Chromium profileのみ。
- 実装コード・業務規則・権限・設定の変更なし。stage／commit／push／PR／ストア申請なし。

[導入手順](../onboarding.md)、[プライバシー](../privacy.md)、[公式規約の確認](../policy-review.md) を作成。公開配布可とは断定していない。規約調査の重大条件は親へ早期報告した。公式ページ閲覧は、実キー付きAPI通信や実DOM検証とは別。

## 独立作業時の新規自動検証の縦RED→GREEN

`tests/documentation.test.ts` は実ファイルとローカル導線を検査する。法的適合性や自然言語の全説明の正しさを判定するテストではない。

| 縦slice | RED（bareコマンド） | GREEN |
| --- | --- | --- |
| README→日本語導入手順 | `npm run test -- tests/documentation.test.ts`：導入リンク欠落で1 failure、exit 1 | README導線と導入文書を追加、1 passed、exit 0 |
| 導入→プライバシー／公式規約記録 | 同コマンド：privacyリンク欠落で1 failure＋既存1 passed、exit 1 | 2文書と導線追加、2 passed、exit 0 |
| README→#6検証記録 | 同コマンド：#6検証記録リンク欠落で1 failure＋既存2 passed、exit 1 | この文書とREADME導線追加、3 passed、exit 0 |

初回 `npm run test` は依存未導入のため `vitest: not found`、exit 127。これはTDDのREDではなく環境の失敗として区別する。`npm ci` はexit 0、audit脆弱性0。esbuild postinstallがallowScripts未登録という警告があったが、その後の実buildは成功した。Hermes設定／npm設定の書換えはしていない。

## 独立作業時の回帰実行（#4 base）

第2sliceのGREEN後に `npm run check` をbareで実行し、exit 0：

- Vitest：14 files、164 tests passed（#4既存＋新規docs 2 tests）。
- strict typecheck：成功。
- build：production dist生成成功。
- 実Chromium MV3：20 tests passed。YouTube／Jev要求はroute fixtureへ置換。
- 新規第3slice後の最終結果はこの文書の末尾に記録した。

`check` 内のnpm scriptsは `&&` で順に実行し、前段失敗を保持する。外側でhead／tailや成功に見せる `||` は使っていない。

## 検証レベルを混同しない

| レベル | 独立作業での結果／限界 |
| --- | --- |
| 自動unit | 上記checkで成功。fake clock、fetch fixture、pure policy、sender境界等。実時刻／実サービスとは別 |
| API fixture統合 | Google／Jev固定応答でproduction background→monitor等を実行。応答値は人が設定した値で実Jev精度ではない |
| 実Chromium MV3 | 実拡張読み込み、実worker、trusted／content／external境界、キーUI等を実行。一時profile・headless Chromiumであり通常Windows Chromeではない |
| 実YouTube DOM | #6独立作業では未実施。#5では隔離Chromiumで実text-messageをlocal seedしてiframe/popoutの非表示・復元を観測。実APIからの登録ではない。[#5記録](issue-5.md) |
| 実Google／Jev API | 未実施。実認証、キー制限、quota消費、請求、モデル速度／精度／注入耐性はチェック未達 |
| 通常Windows Chrome | 未実施。OSツールバークリック、Windowsからのunpacked読み込み、通常profileでの操作は未確認 |
| 長時間運用 | 未実施。実配信の継続、worker終了、timer throttling、DOM仮想化、メモリ増加の測定は未確認 |

E2EのactiveTabはCDP `Extensions.triggerAction` で実actionを呼び、その後非activeタブで同一production popupをexerciseする。OSのpopup操作とは違う。race E2EはUIのIPC応答順序を制御し、Google／Jev API fixture統合とは別に扱う。

## 要求シナリオごとの実行結果

以下は#6独立作業時の#4 baseで実行した既存テストの範囲。#5統合後の結果ではない。#5側のfixtureと実DOM測定は [#5検証記録](issue-5.md) を参照。

| シナリオ | 今回の実行根拠・結果 | まだ確認していないこと |
| --- | --- | --- |
| 大量チャット | `tests/jev-history.test.ts` の25件／40件等で履歴上限・古い本文解放・順不同連投をunit確認。全unit成功 | これを大量chatの負荷測定達成とは扱わない。数千件DOM／Jev queue／長時間性能／#5非表示大量行は未実施 |
| 同名投稿者 | #4 unit／Jev fixture E2Eで別authorIDを文脈から除外する処理は成功 | 実DOMで同じ表示名・異なるauthorIDを非表示誤爆しないことは#5待ち。表示名が同じケースを実測済みとは書かない |
| 通信障害 | YouTube quota／不正応答で停止・自動retryなし、Jev 401 fixtureで判定通信停止・秘密本文非透過をproduction MV3 E2Eで成功。network／429／529等のunitも成功 | 実provider障害・実ネット切断・実請求挙動は未実施 |
| 配信終了 | `tests/youtube-monitor.test.ts` のendedで最終通知後に停止、clientの終了error分類unit成功 | 実配信終了の実API／実DOMと#5リスト維持は未実施 |
| タブ遷移 | `e2e/youtube-monitor.spec.ts` で別videoIDへgoto後、開始不可・再選択案内を実MV3＋fixtureで成功 | YouTube実SPA／iframe差替え・#5の別配信リスト分離は未実施 |
| 再起動 | `e2e/credentials-security.spec.ts` で実Chromium／workerを再起動、架空キー保持・UIへ値を戻さないことを成功。handler unitでworker再作成cooldown継承も成功 | #5リスト再適用、実取得中のworker強制終了、通常Windows Chrome再起動は未実施 |

停止＝取得／判定のみ停止、登録済みの非表示維持、明示解除で復元、配信別videoIDのlocalリスト保持は#5実装・fixtureで確認されている。ただし実API経由の登録と長時間実配信は未検証。

## 秘密・配布物の限定監査

`node scripts/package.mjs` で実zipを生成（exit 0）。これは既存check後の梱包で、#5込みの最終 `npm run package` 成功とは区別する。

一時監査script `/tmp/issue6-audit.mjs` を実行しexit 0：

- git trackedファイルと、その時点の今回追加docs／testを合計67ファイル検査。
- `.env*`、鍵・credential JSON・profile・log等の禁止tracked pathなし。これらの実ファイル内容は読まない。
- Googleキー、private key、GitHub token、AWS access keyの既知形式パターンに一致なし。一致しても値を出さない監査。
- zipは明示allowlistの9エントリだけ：`background.js`、`content.js`、`manifest.json`、`monitor.html`、`monitor.js`、`options.html`、`options.js`、`popup.html`、`popup.js`。
- distも同じallowlist、zip各エントリがdistとbyte一致。
- production zipにテストの架空キー、fixtureページ、ソース、`.env`、ログ、profileなし。

これは全形式の秘密不存在や全git履歴の監査を証明するものではない。TypeSafeの未知のキー形式や恣意的な文字列を完全検出する保証はない。本作業では実キーを読まず、ビルド入力を固定資産／bundleに限定する既存allowlistと、既知形式走査の両方で確認した。今回追加した検証文書も含めて最終再監査し、68ファイル／実zip 9エントリでallowlist・byte一致・既知パターン走査が成功した（exit 0）。

## #5統合後の照合と未達

- 現行のmonitor UIは「この配信の非表示投稿者」で選択video ID・channel ID一覧を表示し、各IDの「非表示を解除」で除外。別配信の管理にはpopupでwatch/liveタブを選び直す。一括削除なし。実装は `src/hidden-authors/monitor.ts`。
- `src/hidden-authors/store.ts` は `hiddenAuthors.<video ID>` の `{ ids, revisions }` をlocalへ保存。解除はIDを除いてrevisionを増加し、空recordも残る。worker再起動を跨ぐmessage ID重複排除は永続化されない。[保存・表示の技術契約](../local-author-filter.md)
- `public/manifest.json` は `storage`、`activeTab` とGoogle／TypeSafe／YouTube origin host permission。YouTube権限は現在タブURL照合のためで、path限定権限ではない。contentはchat URLに注入されるが、replayの非表示は未対応。実DOMで確認済みはtext-messageだけ。
- #5の [fixture/実DOM検証](issue-5.md) は、停止・キー削除後の維持、別video分離、同名別ID、再起動後の保持、1000追加renderer末尾の機能確認を含む。1000件は負荷・長時間性能の測定ではない。実DOMは隔離Chromiumでの観測済みID local seed→非表示→monitor UI解除であり、API/Jevによる実登録は確認していない。
- [ ] 実Google／Jevの認証・キー制限・quota／課金・モデル精度、実API IDとDOM IDの直接突合は未実施（実キーなし）。通常Windows Chromeと長時間運用も未実施。
- [ ] 派生判定、ローカル表示変更、API由来IDと解除revisionの保持、公開配布の規約適合は保留。[一次資料と残事項](../policy-review.md) 自動テストや通常PRは公開配布の承認を代替しない。

## 独立作業の最終結果（#4 base、履歴）

第3sliceと文書更新後に `npm run package` をbareで再実行し、exit 0。Vitestは14 files／165 tests、strict typecheck、production build、実Chromium MV3 E2E 20 testsが成功し、実zipを生成した。docsの新規3 testsを含む。#5統合完了ではなく、独立docsの区切りとして報告する。

3文書の番号付き出典は一次資料URL台帳と照合し、citation verifyが成功した。特にYouTube派生データ禁止、TypeSafe Privacyの非学習、MCAの事前同意例外の3つの重要原文は、取得済み公式本文に文字列が存在することも自動照合した。引用照合は法的適合性の証明ではない。

READMEと当時の新規4文書のローカルリンク18件は存在確認成功。`git diff --check` は成功。この段落までの件数・監査は独立作業当時の結果であり、#5統合後の再計測ではない。

## #5統合後の文書TDDとpackage（今回）

`tests/documentation.test.ts` の追加検査を先に書いた。RED 1: `npm run test -- tests/documentation.test.ts` は#5契約へのリンク不足で1 failed／既存3 passed、exit 1。導入／プライバシー手順を現行UI・保存内容に合わせた後GREEN: 4 passed、exit 0。RED 2: 同コマンドは規約文書の#5契約リンク不足で1 failed／4 passed、exit 1。規約文書の権限・metadata表記とREADMEの案内、統合記録を修正した後GREEN: 5 passed、exit 0。これらは文書の重要な導線と古い表現の回帰であり、法的適合性の機械的な証明ではない。

`npm run package` をpipeなしのbareコマンドで**今回1回**実行し、exit 0。内訳はVitest **16 files／176 tests passed**（docsは5 tests）、strict typecheck成功、production build成功、隔離Chromium MV3 fixture E2E **22 passed**、`artifacts/agent-moderator.zip`生成成功。#5統合後の今回の値であり、前節の#4 baseの165 unit／20 E2Eとは別。package成功は実API・実Windows Chrome・実DOMの再測定・規約適合を意味しない。

READMEと今回編集した4文書のlocalリンクを一括検査し、5ファイル／36リンク／missing 0（exit 0）。`git diff --check` 成功。変更はREADME、#6文書4件、`tests/documentation.test.ts` の6ファイルのみで、stage／commit／push／PRは実施していない。ここで実行・編集を停止し、親の単独検証を待つ。
