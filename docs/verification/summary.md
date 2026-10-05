# Issue #1 検証要約

## 対象と環境

- 対象: shinjo15/agent_moderator Issue #1 の初期基盤のみ。
- 作業ブランチ: `feat/issue-1-extension-foundation`。
- WSL / Node.js v26.7.0 / npm 11.19.0。
- Playwright Chromium（Chrome for Testing 153.0.8010.12）を導入して使用。
- commit / push / PRは実施していない。AGENTS.mdは作成していない。

## 縦のRED → GREEN

各段階のGREENを実行してから次のテストを追加した。

| 段階 | REDの実測 | 最小実装とGREEN |
| --- | --- | --- |
| MV3 manifest | manifest未作成のためexistsSyncの期待trueに失敗、exit 1 | manifestを追加。MV3、入口分離、権限、iframe matches、CSPの1テスト成功、exit 0 |
| 自己完結ビルド | build script未作成のため失敗、exit 1 | esbuild・4入口・ローカルHTMLを追加。回帰2テスト成功、exit 0 |
| 設定画面 | Chromiumに実読み込み成功後、設定のheadingが存在せず失敗、exit 1 | 設定説明表示のみ追加。E2E 1件成功、回帰2件成功、exit 0 |
| popup表示・設定リンク | 同じ実読み込み経路でpopupのheadingが存在せず失敗、exit 1 | popup説明とローカル設定リンクを追加。check全体成功、exit 0 |
| 配布zip | package script未作成のため失敗、exit 1 | 明示allowlistで7ファイルだけzip化。package全体成功、exit 0 |

ビルド検証の初回GREEN試行では、インラインscript検出用のテスト正規表現が空scriptの閉じタグを誤検出した。実装ではなくテストの誤りとして修正して再実行し、2テスト成功を確認した。この試行を成功扱いしていない。

初期ログ保存は `set -o pipefail` とteeで行ったため失敗はexit 1で返っている。方針変更後の最終検証はパイプなしのbare commandで実行した。生ログは `.gitignore` の `docs/verification/*.log` でGit対象外とした。

## 最終再検証

`npm ci` の後に `npm run package` を再実行した。

- `npm ci`: exit 0、45 packages、auditの脆弱性0。
- `npm run test`: 3 test files / 3 tests passed。
- `npm run typecheck`: `tsc --noEmit` 成功。
- `npm run build`: 4入口のbundle生成成功。
- Playwright: 1 passed（設定表示、popup表示、設定リンク、入力欄なし、pageerrorなし）。
- `npm run package`: exit 0、`artifacts/agent-moderator.zip` を生成。
- zipのテストではdistと同じ7ファイルであること、および各ファイルの内容一致を確認。

## 実ブラウザ検証の境界

専用の一時プロファイルへ `--load-extension` でMV3を実際に読み込み、service workerの起動と拡張IDを取得した。manifestの設定ページとdefault_popupをchrome-extension:// URLで開いて検証した。通常のユーザーChrome・OSツールバーのクリック操作は検証していない。

YouTube実ページのiframe注入、外部API、キーUI、動画・コメント監視、判定・非表示は対象外であり未検証。background / contentは無操作入口のみ。

## 残事項

- GitHub Actionsは定義済みだが、push禁止のためリモートCIは未実行。CIのNode.js 24環境もここでは未実測。
- npm 11のinstall時にesbuild postinstallがallowScripts未登録という警告が出た。実際のesbuild実行はnpm ci後も成功した。これをビルド失敗としては扱わない。
- 親は差分確認、必要なら通常Chromeの手動確認、その後commit / push / PR / CI確認を行う。

## 親用再実行コマンド

```sh
npm ci
npx playwright install --with-deps chromium
npm run package
git status --short --untracked-files=all
```
