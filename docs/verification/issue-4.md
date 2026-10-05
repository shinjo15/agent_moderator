# Issue #4 検証記録

## 対象

利用者のJevキーによる評価・取得済みコメントの履歴・投稿時刻による連投判定・monitor表示。非表示・BAN・投稿/削除は対象外。

- Jevの7項目noul評価値のどれかが0.8以上で悪質。
- 同一動画/監視session/投稿者の、対象を含む10秒以内10件以上の重複しない投稿でローカル連投。投稿時刻snippet.publishedAtを使用。
- Jevへ送る本文/投稿時刻は同一投稿者の対象時刻以前60秒以内、対象込み最大20件。追加の履歴APIは使わない。
- ネタバレは対象外。批判・引用・注意喚起・非攻撃的冗談等をそれだけで悪質扱いしない固定rubric。

## TDDと回帰範囲

主実装者は縦RED→GREENでAPI契約/0.8境界/履歴60秒20件/10秒10件/重複/時刻不正・欠落/RFC3339 offsetと小数秒/失敗・不正応答/キー変更/停止/遅延応答/IPC判定整合性を追加。fixture値は人が割り当てたテストデータであり、Jevの実際の日本語分類精度を測ったものではない。

独立レビューでactiveBindingの旧snapshot上書きraceを発見した。主実装者を停止し、第三contextがこの1件だけを修正した。

- 旧Aのsession.get応答をpromiseで保留し、B選択・Jev有効化・履歴作成後に旧応答を解放。
- status/cancel × A close/遷移の4ケースで新Bの結果消失をREDで再現したと第三contextが報告。
- snapshot代入/cancel前の世代検証と、generation付きactiveBinding/現世代だけの即時resetで修正。
- GREENではBの結果保持、既存本文を含むhistory、新着評価継続、重複送信防止、旧要求のabortedを確認。当該handlerテスト15件成功。
- 独立再レビューで前回指摘の解消と原契約の維持を確認し、passed=true、security_concerns/logic_errors/suggestionsは空。

RED/GREENの実行順・失敗内容は実装担当の報告と回帰コードを確認した。親は修正後の全GREENを別途実行した。sleepで競合を再現するテストではない。

## 親の最終実行結果

`npm run package` をpipe等で終了コードを隠さず単独実行し、exit 0。

- Vitest: 13ファイル、162件成功。
- TypeScript strict: `tsc --noEmit` 成功。
- production dist build: 成功。
- Playwright: 実ChromiumへのMV3読み込み、20件成功。
- zip生成: 成功。
- `git diff --check`: 成功。
- `npm audit --omit=dev`: 0 vulnerabilities（開発依存を含む全サプライチェーンの安全性の証明ではない）。

E2Eの区別:

- `e2e/jev-monitor.spec.ts`: production distのYouTube fixture→monitor→background→Jev全項目fixture→評価表示。明示有効化、失敗、秘密非返却、sender拒否を確認。
- `e2e/jev-monitor-race.spec.ts`: production monitorのIPC応答と変更通知を制御して遅延応答を確認。これは実外部APIの経路を測るものではない。
- #1〜#3のキー管理、実content/external sender、取得継続、初期status競合の回帰も全件実行。

## 配布物

`artifacts/agent-moderator.zip` はmanifestとHTML/JSの9エントリのみ。全エントリが同じ実行で生成したdistとbyte一致。

SHA-256: `3bc528e9bc9f2d7a9288730011cd96128c8c2ae48d9967042a9d80d8960f6057`

host_permissionsは`https://www.googleapis.com/*`と`https://api.typesafe.ai/*`のみ。生ログ・fixture・ソース・キーはzipに含めない。src内の秘密形式/eval/new Function/innerHTML/consoleの静的検索は0件だったが、環境全体の秘密不在や完全な安全性を証明するものではない。

## 未検証・承認境界

実キーは参照せずsyntheticキーとAPI fixtureのみ使用した。以下を検証済みと扱わない。

- 実YouTube/Jev APIの認証成功と実レスポンス。
- Jevの日本語精度、実モデルのprompt injection耐性、速度、費用、クォータ。
- 長時間のworker終了/再起動/throttlingを伴う実運用。
- 通常Windows Chromeのユーザープロファイル、OSツールバーの手動操作。

モデルの宣伝上の数値を実測結果へ置き換えていない。キー保存はローカルの秘密保管庫ではない。実キーはチャットやGitへ送らず利用者の設定画面で入力する。PR/CI結果は親がpush後に別途確認する。
