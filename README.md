# Agent Moderator

YouTube Live向けChrome拡張機能です。Issue #1のManifest V3基盤に、Issue #2の利用者自身のJev / YouTube APIキー管理を追加しています。コメント取得、AI判定、非表示、動画監視、外部API通信はまだありません（Issue #3〜6の範囲）。

## 技術選定

vanilla TypeScript + esbuildを採用しました。静的な2画面と2つの処理入口だけなのでUIフレームワークや開発サーバーは不要です。Vitestでmanifest・ビルド・配布物、Playwrightで実際のMV3読み込みを検証します。拡張内で使うスクリプトは全てローカルにbundleし、CDN・外部配信コード・独自バックエンドは使いません。

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
自動E2Eは専用の一時プロファイルを使い、通常プロファイルを変更しません。実Chromiumでキーの保存・差替え・空欄保持・個別削除、ページreloadとブラウザ/service worker再起動後の保持、popupの設定リンクを確認します。YouTubeチャットURLをローカルHTML fixtureで応答し、manifestから注入された実content isolated contextのlocal読取拒否とmessage拒否も確認します。別の一時拡張を読み込んで実external senderの拒否も確認します。OSのツールバークリック、通常のユーザーChromeの手動操作、ライブのYouTubeページ、実API通信は未検証です。

## キーの設定と保護範囲

- 設定画面のパスワード入力から、Jev / YouTubeキーを個別に保存・差替え・削除できます。空欄保存は既存値を保持します。入力文字列のtrimや接続確認はしません。
- 画面に戻す情報は設定済みbooleanだけです。保存済みキー、末尾文字、マスクされた保存値も返しません。処理完了時は失敗時も入力欄を空にし、エラーは秘密を含まない固定文言に限定します。
- 保存先は拡張専用の `chrome.storage.local` のみです。同期ストレージ・Web localStorageは使いません。backgroundは毎起動時に `setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })` を開始し、すべてのread/write/deleteは成功をawaitします。初期化失敗時はアクセスせずfail closedです。
- local保存は暗号化された秘密保管庫ではありません。端末・ブラウザプロファイルにアクセスできる人やtrusted拡張contextからのアクセスを防ぐものではありません。実キーをコード・ログ・アクセス解析へ出力しないでください。
- 将来フィルターを使用するとコメントをJevへ送信します。Jevの利用料とYouTube APIクォータは利用者が負担します。この版では通信や接続確認を行わないため、「設定済み」はキーの有効性・課金状態・利用可能クォータを保証しません。
- 未設定時は「設定が必要です」と表示します。現在の版は設定の有無にかかわらず外部APIを呼びません。

## 後続Issue向け内部API契約

`src/credential-store.ts` はprovider別のキーアクセスを集約します。#3はtrusted background内で `readYouTubeApiKeyForBackground(): Promise<string | undefined>` をimportして呼び出してください。Jevは `readJevApiKeyForBackground()` が同じ契約です。

未設定・削除後は `undefined`、初期化/読取失敗はrejectです。呼び出し側はAPI呼出しの直前に読み、未設定なら通信を開始せず設定へ誘導します。生キーの長期キャッシュやcontentへの送信は禁止です。削除前から進行中の通信をキャンセルする機能はこのIssueにはありません。

設定用messageは同一拡張IDかつ `options.html` / `popup.html` の完全一致URLだけを許可します。タブとして開いたoptionsにもsender.tabが付くため、tabの有無だけでは判定しません。

- `{ type: 'storage.init' }`: 初期化をawaitして設定状態を取得。
- `{ type: 'credentials.save', provider: 'jev' | 'youtube', value: string }`: provider別保存。空文字は保持。
- `{ type: 'credentials.delete', provider: 'jev' | 'youtube' }`: provider別削除。
- 成功応答は `{ ok: true, status: { jev: boolean, youtube: boolean } }` のみ。
- content sender、外部sender、不正payload、キー取得要求は固定拒否応答。内部キー読取関数の結果をpublic messageへ載せることは禁止です。

## 構成・責務

- `public/manifest.json`: MV3宣言・入口・CSP。
- `public/options.html`, `src/options.ts`: パスワード入力・設定状態表示・個別保存/削除。
- `public/popup.html`, `src/popup.ts`: ポップアップ。未実装の説明と設定リンクのみ。
- `src/background.ts`: 毎起動のstorage初期化・trusted設定message処理・content/外部sender拒否。
- `src/credential-store.ts`: 初期化gate、local保存とprovider別background内部読取API。
- `src/extension-runtime.ts`: 利用するChrome runtime APIの最小型境界。
- `src/content.ts`: チャットフレーム入口。現時点では副作用なし。
- `scripts/build.mjs`: dist生成。`scripts/package.mjs`: 明示した7ファイルのみzip化。
- `tests/`: manifest・配布契約。`e2e/`: 実ブラウザ検証。
- `docs/verification/summary.md`: Issue #1の検証記録。`docs/verification/issue-2.md`: キー管理の縦RED→GREEN・実ブラウザ・最終検証。生ログはGit対象外。

## 最小権限とYouTube iframe方針

`permissions` はキー保存に必要な `storage` だけを宣言します。`host_permissions`、tabs、scripting、activeTab、全サイトアクセスは追加しません。静的content_scriptsのmatchesだけで `https://www.youtube.com/live_chat*` と `live_chat_replay*` にアクセスします。このURLアクセスは権限ゼロという意味ではなく、インストール時にYouTubeへのアクセス表示が出る可能性があります。

チャットはwatchページ内の別フレームなので `all_frames: true` とし、各フレームのURLがmatchesに合う場合だけ注入します。トップのwatchページ、他サイト、about:blankへの注入や動画監視は実装しません。チャットを独立ウィンドウで開いた場合もURL一致時に入口が対象になります。現段階のcontent入口は何もしません。将来のDOM取得やSPA対応、注入の実ページ検証は後続Issueです。

## 秘密保護・対象外

実キーは参照・出力・同梱しません。テストはsyntheticダミーだけを使います。`.env*`、鍵ファイル、node_modules、生成物、ブラウザプロファイルはGit対象外です。distにはpublicの固定資産とbundleだけを生成し、zipはさらに明示allowlistに限定します。ソースに秘密を直書きすれば保護できないので禁止します。Jev / YouTube API通信、コメント・動画監視、BAN・削除・投稿、モデレーター権限、Twitchは対象外です。

commit/push/PRとCI確認は親担当です。このworktreeの子担当は編集・検証・報告のみを行います。
