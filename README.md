# Agent Moderator

YouTube Live向けChrome拡張機能の開発基盤（Issue #1）です。Manifest V3で設定画面とポップアップを開けます。コメント取得、AI判定、非表示、認証情報の入力・保存、動画監視はまだありません。Issue #2〜6の機能は実装しません。

## 技術選定

vanilla TypeScript + esbuildを採用しました。静的な2画面と2つの処理入口だけなのでUIフレームワークや開発サーバーは不要です。Vitestでmanifest・ビルド・配布物、Playwrightで実際のMV3読み込みを検証します。拡張内で使うスクリプトは全てローカルにbundleし、CDN・外部配信コード・独自バックエンドは使いません。

## セットアップ・検証

Node.js 24 LTS以上とnpmを使用します。

```sh
npm ci
npx playwright install --with-deps chromium
npm run test       # manifest・ビルド・zipのテスト
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
自動E2Eは専用の一時プロファイルを使い、通常プロファイルを変更しません。Chromiumのservice worker起動を確認し、manifestが指すchrome-extension://の設定ページとpopupページを開き、表示・キー入力欄がないこと・設定リンク・JSエラーがないことを確認します。OSのツールバークリックそのものは自動化していません。通常のユーザーChromeの手動操作とYouTube実ページへの注入は未検証です。

## 構成・責務

- `public/manifest.json`: MV3宣言・入口・CSP。
- `public/options.html`, `src/options.ts`: 設定画面。基盤説明のみ。
- `public/popup.html`, `src/popup.ts`: ポップアップ。未実装の説明と設定リンクのみ。
- `src/background.ts`: MV3 service worker入口。現時点では副作用なし。
- `src/content.ts`: チャットフレーム入口。現時点では副作用なし。
- `scripts/build.mjs`: dist生成。`scripts/package.mjs`: 明示した7ファイルのみzip化。
- `tests/`: manifest・配布契約。`e2e/`: 実ブラウザ検証。
- `docs/verification/summary.md`: 縦のRED→GREENと最終検証の要約。生ログはGit対象外。

## 最小権限とYouTube iframe方針

`permissions` / `host_permissions` は不要なため宣言しません。storage、tabs、scripting、activeTab、全サイトアクセスも要求しません。静的content_scriptsのmatchesだけで `https://www.youtube.com/live_chat*` と `live_chat_replay*` にアクセスします。このURLアクセスは権限ゼロという意味ではなく、インストール時にYouTubeへのアクセス表示が出る可能性があります。

チャットはwatchページ内の別フレームなので `all_frames: true` とし、各フレームのURLがmatchesに合う場合だけ注入します。トップのwatchページ、他サイト、about:blankへの注入や動画監視は実装しません。チャットを独立ウィンドウで開いた場合もURL一致時に入口が対象になります。現段階のcontent入口は何もしません。将来のDOM取得やSPA対応、注入の実ページ検証は後続Issueです。

## 秘密保護・対象外

実キーは参照・出力・同梱しません。`.env*`、鍵ファイル、node_modules、生成物、ブラウザプロファイルはGit対象外です。distにはpublicの固定資産とbundleだけを生成し、zipはさらに明示allowlistに限定します。ソースに秘密を直書きすれば保護できないので禁止します。Jev / YouTube API通信、キーUI、コメント・動画監視、BAN・削除・投稿、モデレーター権限、Twitchは対象外です。

commit/push/PRとCI確認は親担当です。このworktreeの子担当は編集・検証・報告のみを行います。
