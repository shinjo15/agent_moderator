# フィルターの強さ・判定の基準値

## ユーザー設定

- 設定画面の「フィルターの強さ」は、高0.65／中0.8／低0.9。未保存のlegacyプロファイルの初期値は中0.8。
- 「詳細設定」の「判定の基準値」では0〜1 inclusiveの有限数値を入力し、専用保存ボタンで保存する。空欄、NaN、Infinity、文字列のIPC数値、範囲外を拒否する。画面の呼称だけを変更し、内部threshold契約は維持する。
- 強さ選択は下書きであり、保存前には適用しない。詳細入力の変更はカスタム選択へ切り替わる。preset選択は詳細の入力値も同じpreset閾値へ上書きする。
- 永続化するのは数値thresholdだけ。保存後／再読込後は0.65・0.8・0.9なら対応preset、それ以外はカスタムを表示する。presetと同じ値を詳細入力から保存しても別のmodeを永続化しない。
- 読込時は「現在の設定」、保存とreadback確認後だけ「保存しました」と表示する。未保存のlegacy既定値を「保存済み」と呼ばない。選択中／未保存値、読込／保存中、入力不正、保存失敗を別に表示し、書込後readbackの一致を確認するまでは成功表示しない。
- キー操作のbusy状態・入力clear処理と独立している。フィルター設定を保存しても未送信のAPIキー下書きは送信・変更・消去しない。

## 保存と秘密境界

backgroundの`src/jev/settings.ts`が、`initializeCredentialStorage()`のTRUSTED_CONTEXTS gate完了後、`chrome.storage.local`の`moderation.threshold`だけをget/setする。Chromeプロファイル内でリロード・worker/browser再起動を跨いで保持する。sync、Web localStorage、session storageには保存しない。

- readの保存値未定義だけが既定中0.8へfallbackする。不正な保存値は失敗として扱い、trustedな正しい値の再保存で修復できる。
- saveは有限0〜1のnumberを検証し、書込後に同じlocal keyのraw値を読んで完全一致を確認する。読戻し未定義を既定値に置き換えて成功としない。UIでもsave応答と後続getの値を照合する。
- 読書きは前回保持修正の共通有界queueを使って直列化する。待機上限200件・待機期限60秒。超過／期限切れは固定失敗応答。設定保存の無期限queueを新設しない。
- 読込 `{type:'settings.getFilter'}` は同一extension IDと完全一致のoptions/popup/monitor URLからだけ許可する。
- 保存 `{type:'settings.saveFilter',threshold:number}` は同一extension IDと完全一致のoptions URLだけ。余分なpayload、content、external sender、他URLからの書込は拒否する。
- 成功応答は `{ok:true,value:{threshold:number}}` だけ。設定の失敗は固定の`{ok:false,error:string,code:FilterSettingsReason}`。生APIキー、本文、providerのstorage/error本文を応答へ混ぜない。既存credential status応答はbooleanのみで、credentials応答へcodeを追加しない。

## 判定への適用

7項目のraw noul評価値のいずれかが`>= threshold`なら悪質。丸めた表示値では比較しない。0は全評価済みコメントが悪質（全7理由）、1は評価値1の項目だけが該当する。未評価や失敗をthreshold 0によって悪質へ変換しない。

- 観測時／enqueue時ではなく、新しいJev評価開始時（待機queueから実行開始して最初のsettings読込）にthresholdを一度捕捉する。settings読書きqueueの順序でsnapshotが確定する。
- 実行中に保存値が変わっても、すでに捕捉したthresholdで判定する。queuedでまだ開始していない評価は開始時点の新設定を読む。
- 成功した`jev:'evaluated'`結果に評価時`threshold`を保持する。同ID cached結果のthreshold・decisionは変更せず、再Jev送信もしない。cacheは前回保持修正の一時TTL／上限内だけ。
- runtime validationは結果内の有限0〜1 thresholdを必須とし、その値でraw評価値とmalicious/reasonsを照合する。現在の設定や固定0.8で古い正しい結果を拒否しない。チャット画面も評価時thresholdを「判定の基準値」と表示する。判定スコアは7項目の最高値を小数点以下2桁で示し、「項目別スコア」は丸め前の数値を表示する。
- settings読取失敗／不正値はJev要求を送らず既存の判定失敗経路へ入る。悪質／正常には確定しない。
- thresholdはアプリ側policyにのみ使う。Jevの固定questions/rubric/stateを変更せず、保存によるJev要求、自動再判定、自動retryを追加しない。

連投10秒10件、文脈60秒・最大20件、本文／観測ID／判定結果／DOM／queueの前回保持制限、停止・解除revisionと遅延評価安全性は変更しない。配信別非表示IDはlocal永続・明示解除まで保持し、設定変更で自動解除しない。キー変更に連動した設定の初期化も行わない。

## 検証の境界

### 保存の確認コード

通常の失敗表示の末尾に `確認コード: filter-<段階>-<固定reason>` を表示する。初期取得は `initialGet`、保存要求は `save`、保存成功応答後の追加読戻しは `readback`。値・URL・profile・APIキー・例外messageはコードにも表示にも含めない。ユーザーからはこのコードだけを受け取り、次の調査対象を絞る。原因そのものの確定や実Chromeでの解消を保証するコードではない。

- backend reason: `authorization`（exact sender/payload境界拒否）、`initialize`（trusted storage初期化）、`read`（設定読取）、`write`（書込）、`readback`（書込直後の読戻し失敗/不一致）、`invalidStored`（不正保存値）、`invalidInput`（不正入力値）、`unavailable`（未分類の待機/処理失敗）。
- UI reason: `transport`（runtime要求がreject）、`noResponse`（null/undefined応答）、`responseDeniedLegacy`（codeなし・既知の旧固定拒否）、`unknownFailureCode`（失敗応答のcodeが不明/欠落）、`invalidShape`（成功応答の形状/数値型・範囲が不正）、`valueMismatch`（有効な成功数値が要求値と不一致）。`inconsistentResponse`は未分類のローカル例外のfallbackだけに残す。生error本文は表示せず、backend codeも固定whitelistだけを受け入れる。
- 形状診断は `shape:xxxxxx` の固定6 booleanだけ。順番はobject（非null/非array）、okTrue、okFalse、valueObject（非null/非array）、thresholdNumber、thresholdValid。例: boolean応答は`000000`、旧固定拒否は`101000`、thresholdが文字列の成功応答は`110100`。任意のerror/code/値・URL・profileを埋め込まず、response objectをログへdumpしない。
- 現行monitorのlistenerは非asyncでfalseを返しreplyしない。実monitorとactual popupの同時openで保存成功を検証する。故意のreply(false)対照faultや旧dispatcherとの混在は実Chromeで再現できるが、ユーザー環境の原因確定ではない。旧dispatcherソースは`e2e/fixtures/legacy-background-source.txt`に固定し、現行依存moduleでcompileして旧dispatch境界だけを検証する（旧release全体の再現ではない）。
- `filter-save-readback` はbackendの書込直後確認の失敗、`filter-readback-read` はUIの追加読戻し要求中のstorage読取失敗であり、混同しない。失敗時は保存成功と表示しない。
- trusted storage初期化の失敗Promiseは破棄する。失敗した操作は失敗のままとし、後続操作で再初期化に成功するまで読み書きしない。成功したgateは共有する。これにより一時初期化失敗がworkerの存続中ずっと再利用される経路を防ぐ。Jev/YouTube要求の自動retryは追加しない。

unitとheadless Chromium MV3 E2Eでpreset/custom/0/1、不正値、読戻し失敗、キー下書き保持、非trusted拒否、再起動、in-flight/cached snapshot、実production policy/runtimeからローカル非表示までを検証する。Jev/YouTubeの応答はfixtureであり実API実績ではない。実API精度・課金・速度、利用規約適合、ユーザーのWindows Chromeでの可視UIは未検証。
