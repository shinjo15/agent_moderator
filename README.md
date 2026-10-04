# Agent Moderator

YouTube Live向けChrome拡張機能です。MV3基盤、利用者自身のAPIキー管理、YouTube公式APIからのライブチャット継続取得に対応します。AI判定、非表示、BAN、投稿/削除、Jevへのコメント送信は未実装です。

## 技術選定

vanilla TypeScript + esbuildを採用しました。設定・popup・monitorの小さな画面なのでUIフレームワークや開発サーバーは不要です。VitestとPlaywrightでAPI core・sender境界・配布物・実MV3読み込みを検証します。スクリプトは全てローカルにbundleし、CDN・外部配信コード・独自バックエンドは使いません。list/streamListの比較と採用理由は [docs/youtube-chat.md](docs/youtube-chat.md) を参照してください。

## セットアップ・検証

Node.js 24 LTS以上とnpmを使用します。

```sh
npm ci
npx playwright install --with-deps chromium
npm run test       # キー管理・sender境界・manifest・ビルド・zipのテスト
npm run typecheck  # TypeScript strict検査
npm run build      # dist/を毎回削除して生成
npm run test:e2e   # build後、Chromiumに拡張を実読み込み
npm run check      # test → typecheck → build → E2E
npm run package    # check成功後、artifacts/agent-moderator.zip
```

CIはNode.js 24 / Ubuntuで同じpackageコマンドを実行します。CIにはAPIキー・Secrets・外部APIが不要です。CIの実行結果はpush後に親が確認します。

## Chromeへの開発読み込み

1. `npm run build` を実行する。
2. Chromeの `chrome://extensions` で「デベロッパーモード」を有効にする。
3. 「パッケージ化されていない拡張機能を読み込む」でこのworktreeの `dist/` を選ぶ（ソースディレクトリやzipではない）。
4. 拡張の詳細から「拡張機能のオプション」を開く。
5. ツールバーに拡張を固定し、アイコンからポップアップを開く。
6. 変更後はbuildし、拡張一覧で再読み込みする。

WSLの場合はWindowsから参照できるdistディレクトリを選びます。
自動E2Eは専用の一時プロファイルを使い、通常プロファイルを変更しません。実Chromiumでキー管理、未送信入力保持、content/external sender拒否を確認します。YouTube取得はproduction distとCDP actionによるactiveTab許可、非activeタブで開く同一production popupを使い、monitor/background/credential-storeを通してAPI fixtureで継続・停止・エラー・動画遷移を確認します。詳細な検証境界はdocs/youtube-chat.mdに記録します。OSのツールバークリック、通常Chromeの手動操作、実ライブ配信、実キー/実API通信は未検証です。

## キーの設定と保護範囲

- 設定画面のパスワード入力から、Jev / YouTubeキーを個別に保存・差替え・削除できます。空欄保存は既存値を保持します。入力文字列のtrimや接続確認はしません。
- 画面に戻す情報は設定済みbooleanだけです。保存済みキー、末尾文字、マスクされた保存値も返しません。保存・削除の完了時は失敗時も対象providerの入力欄だけを空にし、別providerの未送信入力は保持します。初期storage.initは成功・失敗とも入力を変更しないため、初期確認中に入力した下書きも保持します。エラーは秘密を含まない固定文言に限定します。
- 保存先は拡張専用の `chrome.storage.local` のみです。同期ストレージ・Web localStorageは使いません。backgroundは毎起動時に `setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` を開始し、すべてのread/write/deleteは成功をawaitします。初期化失敗時はアクセスせずfail closedです。
- local保存は暗号化された秘密保管庫ではありません。端末・ブラウザプロファイルにアクセスできる人やtrusted拡張contextからのアクセスを防ぐものではありません。実キーをコード・ログ・アクセス解析へ出力しないでください。
- この版は取得開始時にYouTube APIへ通信し、YouTube APIクォータは利用者が負担します。Jevへの送信はまだありません。将来Jev判定を利用するとJev利用料も発生します。保存だけでは接続確認を行わず、「設定済み」はキーの有効性・課金状態・利用可能クォータを保証しません。
- 未設定時は取得を開始できません。Google Cloud projectでYouTube Data API v3を有効化し、自分のAPIキーを設定してください。公開ライブチャットの実APIキー認証成功は未検証です。テストはAPI fixtureと架空キーだけを使います。

## ライブチャットを取得する

1. YouTubeキーを設定し、`https://www.youtube.com/watch?v=...` または `/live/...` の視聴タブを開く。
2. そのタブで拡張アイコンを押し、「この動画のチャットを取得」を押す（activeTabによる一時アクセス）。
3. 開いたmonitorページの「取得を開始」を押す。取得内容・投稿者ID・状態を確認できる。
4. YouTube視聴タブを前面に戻しても継続する。裏のmonitorはChromeのtimer throttlingにより取得が遅れる場合があるが、API指定間隔より早く要求しない。
5. 明示停止、monitorページを閉じる/離れる、視聴動画の遷移/タブclose、キー変更/削除で停止する。キー変更後は明示再開、別動画はpopupから選び直す。

取得元はvideos.listとliveChatMessages.listのみ。初回取得は直近の一部であり全履歴ではありません。nextPageToken継承・pollingIntervalMillis遵守・重複ID防止を行い、quota/auth/network/不正応答等では自動再試行しません。明示再開もcooldown/Retry-Afterを守ります。filter/非表示/BAN機能ではありません。

対象bindingの生成・削除・liveChatId更新は共通の状態排他と世代で保護し、古いイベントや取得結果による新対象の削除・旧対象の復活を防ぎます。進行中要求のAbortは状態排他やAPI応答待ちより先に行います。monitorの初期statusも変更通知で世代を失効させ、遅い初期応答で開始可能状態へ戻しません。限定race修正後のローカルpackage検証はunit 80件／実Chromium E2E 16件成功です。実APIは未確認のままです。

## 後続Issue向け内部API契約

`src/credential-store.ts` はprovider別のキーアクセスを集約します。#3はtrusted background内で `readYouTubeApiKeyForBackground(): Promise<string | undefined>` をimportして呼び出してください。Jevは `readJevApiKeyForBackground()` が同じ契約です。

未設定・削除後は `undefined`、初期化/読取失敗はrejectです。取得handlerはAPI呼出し直前に読み、未設定なら通信しません。キー変更/削除で進行中要求をAbortし、世代と再読取で遅延結果を隔離します。生キーの長期キャッシュやcontent/monitorへの送信は禁止です。

設定用messageは同一拡張IDかつ `options.html` / `popup.html` の完全一致URLだけを許可します。タブとして開いたoptionsにもsender.tabが付くため、tabの有無だけでは判定しません。

- `{ type: 'storage.init' }`: 初期化をawaitして設定状態を取得。
- `{ type: 'credentials.save', provider: 'jev' | 'youtube', value: string }`: provider別保存。空文字は保持。
- `{ type: 'credentials.delete', provider: 'jev' | 'youtube' }`: provider別削除。
- 成功応答は `{ ok: true, status: { jev: boolean, youtube: boolean } }` のみ。
- content sender、外部sender、不正payload、キー取得要求は固定拒否応答。内部キー読取関数の結果をpublic messageへ載せることは禁止です。

## 構成・責務

- `public/manifest.json`: MV3宣言・入口・CSP。
- `public/options.html`, `src/options.ts`: パスワード入力・設定状態表示・個別保存/削除。
- `public/popup.html`, `src/popup.ts`: activeTabによる視聴動画の選択と設定リンク。
- `public/monitor.html`, `src/monitor.ts`: 開いている間の継続取得・本文/投稿者表示・明示開始/停止。
- `src/background.ts`: storage初期化・設定handler・monitor専用一回取得handler・キー/動画変更時の停止。
- `src/youtube/`: 固定endpoint API client、継続core、trusted取得handler、IPC transport、動画ID境界。
- `src/credential-store.ts`: 初期化gate、local保存とprovider別background内部読取API。
- `src/extension-runtime.ts`: 利用するChrome runtime APIの最小型境界。
- `src/content.ts`: チャットフレーム入口。現時点では副作用なし。
- `scripts/build.mjs`: dist生成。`scripts/package.mjs`: 明示した9ファイルのみzip化。fixture/キー/ソースは含めない。
- `tests/`: manifest・配布契約。`e2e/`: 実ブラウザ検証。
- `docs/verification/summary.md`: Issue #1の検証記録。`docs/verification/issue-2.md`: キー管理の縦RED→GREEN・実ブラウザ・最終検証。生ログはGit対象外。

## 最小権限とYouTube iframe方針

`permissions` は `storage` と `activeTab`。`host_permissions` はYouTube Data API取得用の `https://www.googleapis.com/*` のみ。tabs/scripting/offscreen/全サイトアクセス権限は追加しません。activeTabはユーザーが拡張を呼び出した視聴タブに一時的なアクセスを与えます。静的content_scriptsは従来のチャットURL限定で、副作用はありません。

チャットはwatchページ内の別フレームなので `all_frames: true` とし、各フレームのURLがmatchesに合う場合だけ注入します。watchページ、他サイト、about:blankへcontentを注入しません。content入口は何もしません。取得中の視聴動画変更はbackgroundのtabs.onUpdatedと各要求時のtabs.get照合で検出し、停止/再選択を促します。DOM取得/非表示は後続Issueです。

## 秘密保護・対象外

実キーは参照・出力・同梱しません。テストはsyntheticダミーと明示fixtureだけを使います。`.env*`、鍵ファイル、node_modules、生成物、ブラウザプロファイルはGit対象外です。distにはpublic固定資産とbundleだけを生成し、zipは明示allowlistに限定します。Jev送信、AI判定、非表示、BAN・削除・投稿、モデレーター権限、Twitchは対象外です。

commit/push/PRとCI確認は親担当です。このworktreeの子担当は編集・検証・報告のみを行います。
