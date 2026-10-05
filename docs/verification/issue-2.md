# Issue #2 検証記録

## 対象と実行環境

- 対象: shinjo15/agent_moderator Issue #2。`gh issue view 2 --repo shinjo15/agent_moderator` で要件を確認。
- worktree: `/home/ryusei/private/agent_moderator-worktrees/issue-2`
- branch: `feat/issue-2-user-api-keys`
- Node.js v26.7.0 / npm 11.19.0 / Playwright 1.63.0、WSL上のheadless Chromium。
- 実キー・環境の秘密・通常ブラウザプロファイルは参照していない。テストではsynthetic値と一時プロファイルだけを使用。
- 別pane起動、commit、push、PR作成は行っていない。保護命令ファイルは追加していない。

## 縦のRED → GREEN

各変更は対応する失敗をbare commandで確認してから実装した。exit statusをパイプや `||` で隠していない。

| 縦の変更 | REDの実結果 | GREENの実結果 |
| --- | --- | --- |
| trusted初期化成功待ち＋YouTube保存/読取 | `npm run test -- tests/credential-store.test.ts`: module未実装、exit 1 | credential-store追加後、1 test成功、exit 0 |
| 初期化失敗時の削除もfail closed | 同command: deleteApiKey未実装、exit 1 | 削除gate追加後、2 tests成功、exit 0 |
| provider別状態・空欄保持・差替え・削除 | 同command: getCredentialStatus未実装、exit 1 | boolean状態・Jev読取・空欄保持追加後、3 tests成功、exit 0 |
| backgroundの毎起動初期化＋storage.init | `npm run test -- tests/background.test.ts`: setAccessLevel呼出し0回、exit 1 | startup gateとinit応答追加後、1 test成功、exit 0 |
| sender境界 | 同command: contentへstatus成功応答が返ったためexit 1 | 拡張ID・完全一致URLとexternal拒否追加後、2 tests成功、exit 0 |
| trusted保存/削除message | 同command: 保存要求が拒否されたためexit 1 | provider検証・保存/削除処理追加後、3 tests成功、exit 0 |
| storageだけの権限 | `npm run test -- tests/manifest.test.ts`: permissions未宣言、exit 1 | storageのみ追加後、exit 0 |
| password設定UIから実保存 | `npm run test:e2e`: 入力欄なし、exit 1 | UI追加後にsender.tab問題を発見。下記修正後、実保存を含む既存E2E成功、exit 0 |
| タブとして開くoptionsのsender | 実ブラウザでoptionsにsender.tabが付くことを確認しunitにも反映、background testsで2 failures、exit 1 | tabの有無ではなく拡張ID/完全一致URLで判定しunit/E2E成功、exit 0 |
| UIから個別削除 | `npm run test:e2e`: 削除ボタン未実装でtimeout、exit 1 | 個別削除ボタン追加後、保存/更新/削除/reloadを含むE2E成功、exit 0 |

その後、既に実装した境界の回帰・実環境証明として、不正payload、初期化失敗の固定応答、実content context、実external sender、秘密を含む保存例外、ブラウザ再起動、両providerの差替え/空欄保持を追加検証した。これら全てについて新規REDだったとは主張しない。

## 実ブラウザの証明範囲

`e2e/extension.spec.ts` の既存#1回帰を更新し、`e2e/credentials-security.spec.ts` を追加。

- Jev / YouTubeともpassword入力、保存、差替え、空欄保持、個別削除。片方の削除がもう片方を消さない。
- 保存処理後は対象providerの入力欄が空で、別providerの未送信下書きは保持する。reload後は両入力欄が空。UIへのstorage.init応答は `{ ok: true, status: { jev: boolean, youtube: boolean } }` だけ。
- trusted UIからのキー取得messageも拒否。保存済みキーを再表示しない。
- ページreload、同じ一時プロファイルでブラウザ/service workerを再起動した後も保持。
- matching YouTubeチャットURLへのアクセスをローカルHTML fixtureで応答。manifestによる実content注入をCDPの拡張origin＋isolated worldで確認し、そのcontextから `chrome.storage.local.get(null)` が拒否されることを検証。
- 同contentからstorage.init/取得/保存/削除は固定拒否応答。保存キーが変更されないこともtrusted workerでboolean比較して確認。
- ページの通常worldに拡張runtime ID・storage APIがないことも検証。
- 一時的な別MV3拡張から実external messageを送信し、init/取得/保存/削除が固定拒否となることを確認。
- 保存APIにsynthetic秘密を含む例外を発生させ、UIと応答が固定エラーだけになること、入力欄が空になること、page/workerのconsole・pageerrorログが空であること、保存されないことを確認。
- popupの表示、設定リンク、ページJSエラーなしを既存回帰で確認。

最初のcontent検証ではworldのnameを拡張IDと仮定して失敗した。実CDPメタデータを調べるとnameは「Agent Moderator」、originが拡張IDだったため、origin＋isolated typeで対象を選ぶようテストを修正した。製品contentの動作は変更していない。

## 内部APIとセキュリティ契約

- `src/credential-store.ts` にキー管理を集約。保存先は `chrome.storage.local` のみ。
- `initializeCredentialStorage()` をbackground起動時に呼ぶ。read/write/deleteは全て同一のTRUSTED_CONTEXTS成功promiseをawaitする。失敗時は再試行でgateを迂回せず、そのworker起動中はfail closed。
- #3向け: `readYouTubeApiKeyForBackground(): Promise<string | undefined>`。Jevは `readJevApiKeyForBackground()`。未設定/削除後undefined、初期化/読取失敗reject。生キーの長期キャッシュやpublic messageへの返却は禁止。
- 保存状態booleanは接続確認結果ではない。キー有効性、料金、クォータを保証しない。
- 権限変更はstorageのみ。host_permissions・外部API通信は追加していない。
- local保存の限界、コメントのJev送信、Jev利用料・YouTubeクォータの利用者負担をUIとREADMEに明記。

## PR #8 CI失敗の調査・修正

`gh run view 37193837803 --repo shinjo15/agent_moderator --log-failed` で実CIログを取得した。CI実測はunit 11 tests、typecheck、build成功、E2Eは4成功/1失敗。失敗は `e2e/extension.spec.ts:40` のJev入力保持assertionで、YouTube保存後の期待値 `synthetic-jev` に対し実値が空文字だった。これはCIの失敗結果であり、以下のローカル成功結果とは区別する。

修正開始時のworktreeはclean。`npm run build`（exit 0）後、`npx playwright test e2e/extension.spec.ts` で同じline 40の失敗をローカル再現した（exit 1）。元のテストは未設定表示を確認してから両providerに入力しているので、この失敗は初期化待ち不足ではなく、保存finallyの全fieldクリアで未送信のJev入力を消す製品バグだった。

初期storage.initにも同じfinallyが使われていた。実workerのlocal.getをpromise gateで保留し、初期確認中に両入力欄へsynthetic下書きを入力してからgateを解放するテストを追加した。成功・失敗応答のどちらでも下書きが消えることを `npx playwright test e2e/credentials-security.spec.ts -g '初期storage.init'` で再現した（2 failures、exit 1）。固定sleepやretryでタイミングを隠していない。

修正は `src/options.ts` の入力クリア範囲に限定した。requestをinit/save/deleteの判別可能なunion型にし、save/deleteだけ対象providerの入力をクリアする。初期化は入力に触れない。設定状態boolean、固定エラー、処理中ボタン無効化、trusted storage gateは維持。

修正後、元のline 40のassertion・入力順序・待ち時間を変更せず、初期化成功/失敗の2ケースと合わせて3 testsがGREEN（exit 0）。さらにsave/delete/failed-saveのそれぞれについて、YouTube→JevとJev→YouTubeの両方向で対象だけをクリアし、別providerの未送信下書きを保持する回帰を追加した。

現在のローカル差分はoptions UI・追加E2E・README・この記録のみ。background、credential-store、message契約、権限、#3向け内部APIは変更していない。修正後のCI成功はまだ確認していない。commit/pushとCI再実行確認は親担当。

## 最終実行結果（上記UI修正後のローカル）

全てbare commandで実行し、以下のexit statusを確認。

| command | 結果 |
| --- | --- |
| `npm ci`（初回実装時） | exit 0、45 packages追加、0 vulnerabilities。esbuild install-scriptのallowScripts未承認に関するnpm warningあり |
| `npm run test`（check/package内でも実行） | exit 0、5 test files / 11 tests成功 |
| `npm run typecheck` | exit 0 |
| `npm run build`（test:e2e内でも実行） | exit 0、7配布ファイル生成 |
| `npm run test:e2e`（今回package内） | exit 0、実Chromiumの10 tests成功 |
| `npm run check` | exit 0、unit → typecheck → build → E2E成功 |
| `npm run package` | exit 0、同じ全検証成功後zip生成 |
| `npx playwright test --repeat-each=3 --retries=0` | exit 0、10 testsを各3回実行し30成功。retryなし |
| `git diff --check` | exit 0 |

生成物: `/home/ryusei/private/agent_moderator-worktrees/issue-2/artifacts/agent-moderator.zip`（4,333 bytes）。実zipを読み取って下記7エントリのみであることを確認した。テスト/fixture/一時拡張/プロファイルは配布物に含まれない。

- background.js
- content.js
- manifest.json
- options.html
- options.js
- popup.html
- popup.js

## 未検証・後続責務

- 実Jev / YouTube APIの接続・クォータ・料金は未検証。このIssueでは通信自体を実装していない。
- 未設定なら通信せず設定へ誘導する責務、呼出し直前のキー読取、削除前から進行中の通信の扱いは後続API実装側。削除後の内部読取がundefinedになることはunitで検証済み。
- 通常ユーザーChrome、OSツールバークリック、ライブYouTubeページのDOM動作、Windows版Chromeの手動確認は未検証。
- CI実行とcommit/push/PRは親担当。
