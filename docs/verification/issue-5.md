# Issue #5 検証記録

## 対象と区別

対象は配信別local非表示store、公式取得/確定判定からの登録、安全IPC、既存・新着・再利用DOMの非表示、monitor一覧・解除、停止と動画/キー変更の世代境界。仕様・保持とMAIN依存の限界は [../local-author-filter.md](../local-author-filter.md)。

検証を以下の3種類に分ける。

1. unit: storage/API fixtureと制御したpromiseで、配信別永続、解除revision、判定登録、sender/payload拒否、遅延結果を検証。
2. 実MV3 fixture E2E: production distを実Chromiumへ読み、YouTubeページ/公式API/Jevのfixtureで一連の経路を検証。架空のAPI成功を実API成功と扱わない。
3. 実YouTube DOM: 実ページで識別したchannel IDだけを隔離localへseedし、production contentと実monitor UIで非表示・復元を検証。公式API経由の登録や実モデル判定とは別。

実キーは参照せず、実YouTube Data API・実Jevに接続していない。実YouTubeページ自体の描画とチャットの受信は、拡張のData API取得成功の根拠ではない。

## 縦RED→GREENの実行根拠

- `tests/hidden-authors.test.ts`: createHiddenAuthors未実装でexportの期待が失敗（RED）。local store追加でGREEN。video別保持、store再生成後の保持、解除、旧revisionの再登録拒否、新revisionの再登録を確認。
- `tests/youtube-handler.test.ts`: 公式取得fixtureとJev悪質確定後もリストが空でRED。backgroundの観測/結果対応付けと登録接続でGREEN。同じ結果で解除直後に再登録しないこと、後の新規観測なら再登録できることも確認。
- `tests/hidden-author-handler.test.ts`: IPC handler未実装でRED。対象videoのIDだけを返すhandler追加でGREEN。外部ID、他URL、別video、content解除、余分payloadを拒否。
- `e2e/hidden-authors.spec.ts`: production MV3で非表示一覧が存在せずRED。store/IPC、MAIN IDブリッジ、isolated非表示、monitor一覧/解除を接続。
- 同E2Eでiframeは非表示、popoutだけ表示のままで失敗。診断でactiveTab許可のないタブURLが取得できないことを実測。YouTube origin限定の既存#5追加host permissionで、照合を緩めずGREEN。
- ローカル連投: Jev未有効化の10秒10件をlistで取得しても非表示登録されずRED。既存の連投規則によるobserveの確定結果を登録へ接続しGREEN。Jev fetchが呼ばれないことも確認。
- popoutで同一documentのvを別videoへ変更し、新rendererを追加した直後に旧リストでdisplay=noneとなりRED。contentの適用video一致確認と遅延応答時の現在video再確認でGREEN。

これらのREDは該当機能が未実装/欠落していたことを示す実出力であり、全テストを先にまとめて追加して一括実装したものではない。追加の回帰確認は既存GREENを維持している。

## 停止raceの第三context限定修正

独立レビューで、停止と遅延YouTube list応答の間に新規非表示登録が起こり得るraceが報告された。主実装担当は編集を停止し、第三contextが限定修正を担当した。

現在のコードは要求処理のbinding読取前に`selectedCollection`を捕捉し、list成功結果を観測へ渡す前にその捕捉世代との一致を確認する。応答後に新しいcollection世代を取り直して旧listを新規観測として受理しない。

追加された回帰は`stopCollection成功後はcancel未配送でも停止前の遅延listを観測・非表示登録せず既存非表示を維持する`。cancel配送に依存せず停止境界を検証する。親から、限定修正後のunit 171件・実MV3 E2E 22件のpackage成功と、独立再レビュー通過を受領した。第三contextのRED実行ログをこの担当が直接実行したとは記載しない。

本担当による今回の再開作業はREADME/#5 docsとmanifest descriptionの整合のみ。コード・テスト・閾値・permissionは再編集していない。

## fixture全回帰の範囲

#1〜#4の既存162 unit/20 E2Eを維持し、#5と限定修正後は171 unit/22 E2E。

#5の実MV3 fixture E2Eでは以下を実際に確認した。

- 公式取得fixture→Jev全項目fixture→background登録→iframe/popoutの既存・新着非表示→実monitor一覧解除→復元。
- Jev応答をpromiseで待たせた間は表示を維持し、リストは空。
- 同じ表示名でも別channel IDは表示。ID欠落rendererも表示。
- node再利用時のauthor変更、同一documentで別videoへ変更した直後の旧リスト不適用。
- Jev未有効化でのローカル連投→非表示、監視停止中の新着非表示維持。
- 取得503失敗後も既存非表示を維持。
- 隔離browserを実際に閉じて同じテスト専用profileで再起動し、監視なしでもlocalリストを保持。watch iframe/popoutに適用。
- 1000個の追加rendererの末尾も非表示。これはfixtureの機能確認であり、実大量chatの性能測定ではない。
- 別videoは非表示にせず、キー削除後も元videoの非表示を保持。
- 実拡張のisolated worldからlocal読取不可、対象videoのIDsのみ応答、content解除拒否。既存E2Eでexternal senderとキーの非返却も回帰。

Jev遅延中の停止・キー変更・対象変更・解除後の登録拒否はhandler unitで確認。#4のJev遅延UI、#3の取得/停止/遷移/初期化競合も全回帰に含む。一つの実YouTube長時間セッションで全障害を再現したという意味ではない。

## 実YouTube DOMの調査とUA切り分け

隔離Playwright Chromiumのみ使用し、既存ブラウザprofile/Cookie/秘密に接続しなかった。認証/CAPTCHA回避は行っていない。

初回の実browser.versionは`153.0.8010.12`。実UAは次のとおり。

`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.8010.12 Safari/537.36`

実ページのwatch iframe/popoutでは「チャットをご利用いただけません」「ブラウザのバージョンが古い」という画面になり、text-message rendererは0件だった。同じ実Chromium、新しい隔離contextでUAの`HeadlessChrome/`だけを`Chrome/`に変更すると、同じ配信のiframe/popoutに各76件が描画された。バージョン数値は架空に置き換えていない。pageerrorはなし。この差分はHeadlessChrome表記によるcompatibility拒否の仮説を支持する。同一エンジンで描画できたため、実バージョン/JS互換の仮説は支持されず、Xvfb headed試行は不要として実施していない。YouTube内部の判定コードを解析したという意味ではない。

対象URL:

- watch: https://www.youtube.com/watch?v=1-LpQekNa9g
- iframe: https://www.youtube.com/live_chat?continuation=... （実URLにはvなし）
- popout: https://www.youtube.com/live_chat?v=1-LpQekNa9g&is_popout=1

iframeのdocument.referrerは上記watch URL。MAINの初期データにもログインUIの内部pathでvideoIdを観測したが、そのpathの恒常的存在は保証できず、実装のvideo照合に採用していない。popoutのreferrerは空。continuationの推測decodeはしていない。

text-message rendererの観測属性はclass、modern、enable-improved-visibility-style、enable-banner-update、id、whole-message-clickable、author-type。idはmessage ID、whole-message-clickableはopaque context menu endpointであり、channel ID属性とは扱わない。配下リンクhrefは`#`。

MAINではdata.authorExternalChannelIdにUC形式の実channel IDを観測し、同一messageのiframe/popoutで同じIDを確認。CDPの独立isolated worldではdataは見えなかった。MAINからmessageId/channelIdだけをrenderer targetのCustomEventで送る最小実験では、isolatedで同一nodeの受信を確認した。fixtureの架空IDが一致しただけを根拠にしていない。ただし実Data API応答のauthorDetails.channelIdとの直接突合は未実施。

## production distによる実DOM非表示・復元の実測

fixture全package成功後、production distを別の一時profileの`channel: chromium`へ読み込み、上記実YouTube watch/iframe/popoutで検証した。この実測は第三contextの停止race限定修正前のdistによるもの。修正後のData API取得/停止raceを実APIで検証したものではなく、今回の文書整合作業では実DOM再測定をしていない。

実browser.versionは`153.0.8010.12`。このfull Chromiumの実UAはUA reductionにより`HeadlessChrome/153.0.0.0`だった。実UAをそのまま取得して`HeadlessChrome/`だけを`Chrome/`へ変更し、`153.0.0.0`を独自に補正していない。

観測した対象:

- channel ID: `UC1uHmeIRRtBDuHw7DI_rpKA`
- message ID: `ChwKGkNKN0w4THpyb1pjREZYZmtjZ2tkclE0cXFR`

両フレームに存在する実message/channel IDの一致で選び、表示名や本文を根拠に選んでいない。この投稿者を悪質と評価したわけではなく、表示制御テスト用の一時seedである。

| 経路 | renderer数 | seed前 computed display | seed後 | 実monitor UI解除後 |
| --- | --- | --- | --- | --- |
| watchのlive_chat iframe | 76 | flex | none | flex |
| live_chat popout | 76 | flex | none | flex |

対象のinline displayも両方で空文字→none→空文字を実測。production拡張のisolated worldはrendererCount=76、hasData=false、hasChromeRuntime=true。dataをisolatedで直接読むのではなくproduction MAIN→isolatedブリッジで非表示にしたことを確認した。

trusted workerから対象videoのlocal storeへ観測済みchannel IDだけをseedし、保存read-backはtrue。実monitor一覧に対象IDが表示され、「非表示を解除」を押して両フレームを復元した。解除後のlocal.idsが空であるread-backもtrueだった。

Data API/Jevのendpointにはabort routeを設定して実接続しない境界を設け、通信試行の観測配列は`[]`。監視開始・Jev有効化は押していない。チャット送信・削除・BAN、第三者サービスの状態変更はしていない。終了時に隔離browserを閉じ、一時profileを削除した。

調査途中のローカル証跡は`/tmp/agent-moderator-issue-5-dom-investigation.md`、実DOM測定スクリプトは`/tmp/agent-moderator-issue-5-production-live.mjs`。これらはローカル補助資料で、配布zipには含めない。必要な観測結果は本書へ転記した。

## package再実行と配布物

限定修正前に本担当が裸`npm run package`を実行し、unit 170件、実MV3 E2E 22件、strict typecheck、build、zip生成が成功した。その後の限定修正後171件/22件は親の受領報告であり、区別する。

今回の文書/description整合後、本担当が裸`npm run package`をpipeや終了コードを隠す処理なしで再実行し、exit 0を確認した。今回の実出力は以下のとおりで、親報告を代用したものではない。

- Vitest: 15ファイル、171件成功。
- TypeScript strict: `tsc --noEmit`成功。
- production dist build: 成功。
- Playwright: 実MV3 Chromium E2E 22件成功。
- `artifacts/agent-moderator.zip`生成: 成功。
- 文書のlocalリンク検査: missing local linksは空配列。今回manifestのpermissions/host_permissionsを変更していないことも内容照合で確認。

この結果記録を最後に編集を停止し、親の作業待ちとする。Git操作は行っていない。

zipのallowlistはmanifest、3 HTML、6 JSの10エントリ（MAIN専用content-ids.jsを含む）。package unitはzipの全エントリとdistのbyte一致を検証する。キー、fixture、ソース、実験スクリプト、ブラウザprofileは配布対象ではない。zip生成成功は公開配布の承認を意味しない。

## 未検証・保留

- 実YouTube Data API/実Jevの認証、実レスポンス、同一実投稿のAPI IDとDOM IDの直接突合。
- Jevの日本語精度、prompt injection耐性、速度、課金、クォータ。
- 実YouTube上のpaid-message/paid-sticker/membership等の動作、replay、未知/将来DOM。replayは現行非表示の対象外。
- 実長時間のworker終了/throttling、通常Windows ChromeのユーザーprofileとOSツールバー操作。
- MAIN停止時の全面復元保証、ページ側改変に対するIDブリッジの認証保証。未識別rendererはfail-openであり、全てのコメントを必ず非表示にする保証はない。
- 解除後のrevision metadata完全消去、再起動を跨ぐmessage ID重複排除は実装していない。
- 派生データ/表示変更/30日保持等のYouTube利用条件適合、実API利用・公開配布の承認は保留。承認済み保存・数値契約を勝手に変更していない。
