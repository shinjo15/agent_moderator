# Issue #3: YouTubeライブチャット取得coreと統合契約

この文書の検証件数と対象外の記述はIssue #3時点の記録。Issue #4で追加したJev評価と任意の`ChatMessage.publishedAt`は [jev-moderation.md](jev-moderation.md) を参照。既存fixtureの投稿時刻欠落は引き続き許容し、受信時刻で補完しない。

## 現在の範囲

#2最新基盤へrebaseして、credential-storeの既存API、trusted background一回取得handler、popupの視聴タブ選択、monitorページを統合済み。キー保管ロジックと#2既存E2Eは変更していない。optionsはYouTube通信があることを説明する文言のみ更新。#4 Jev判定、#5非表示・BAN、モデレーター権限、投稿/削除APIは対象外。

## 採用方式: liveChatMessages.list

公式資料を読み、独自サーバーなしのChrome拡張で扱うHTTP GET/JSON方式を選ぶ。公式の推奨はstreamListであり、listが効率で優るという判断ではない。

| 比較 | list | streamList |
| --- | --- | --- |
| 接続 | `GET https://www.googleapis.com/youtube/v3/liveChat/messages`、JSON | server streaming。現行公式Pythonサンプルは`grpc.secure_channel("dns:///youtube.googleapis.com:443")`とprotobufのStreamList RPC |
| 継続 | nextPageTokenをpageTokenへ。pollingIntervalMillis以上待つ | 最後のnextPageTokenで再接続可能。新着をpush |
| 認証 | 公開データ用APIキーをGoogleへの一回要求に渡す設計 | 公式サンプルはAPIキーまたはOAuth tokenをmetadataへ渡す |
| Chrome | extension originからhost permissionを使ったfetchが公式に説明されている | native gRPC/HTTP2サンプルをブラウザfetchへそのまま移せる根拠は得られていない |
| MV3 | 一回取得をworkerへ依頼、待機/継続は開いているmonitorページ（hiddenでも継続） | workerの終了、stream切断、再接続を追加検証する必要がある |
| クォータ | ポーリングごとに消費、頻度抑制が必要 | 公式はpushによるポーリング削減・効率向上を推奨 |

streamList referenceにはweb traffic用エラーの記述もある。したがって「Chromeで不可能」「gRPC-Webが非対応」とは断定しない。ブラウザ向け接続・フレーミング・認証・再接続の実証なしに、GETのJSON streamと推測して実装しない。今回はlistの明示されたREST契約を使用する。streamListを実接続しての比較は行っていない。

公式quota calculatorの取得時点の表ではvideos.listとliveChatMessages.listは各1 unit。streamListの個別コストはその表で確認できない。実キーを使った消費量の測定はしていないため、表の記載を実測値として扱わない。利用者のCloud Consoleの実際の上限/使用量を確認すること。

## MV3統合構成

- `monitor.html`を拡張タブとして開き、継続coreをそこで動かす。popupの寿命に依存させず、hiddenだけでは停止しない。YouTube視聴タブでpopupを呼び出し、activeTabで対象tab IDと動画IDを取得する。Google API以外のhost permission、tabs/scripting権限は追加しない。
- monitorを裏に回すvisibilitychange hiddenだけでは停止しない。YouTubeタブで視聴中も取得を継続する。バックグラウンドタブのtimer throttlingによって取得間隔は長くなり得るが、指定intervalより早くcallしない。pagehide/タブclose・明示停止では停止。視聴動画の遷移時は停止し、popupから対象を選び直す。
- backgroundは同一extension IDかつexact monitor.html URL、session bindingのmonitor tab IDを照合する。取得/キャンセル/状態確認をこのmonitorだけに許可し、popup.htmlのみ対象選択を許可する。optionsタブにもsender.tabが付くため、tabの有無では拒否しない。要求payloadにURLやAPIキーを持たせず、content scriptやoptionsから取得APIを呼ばせない。
- worker起動ごとに#2の`initializeCredentialStorage(): Promise<void>`をawaitし、その後`readYouTubeApiKeyForBackground(): Promise<string | undefined>`でキーを読む。キーをmonitor/contentへ返さない。依存moduleは親の許可によるrebaseで取り込み、独自コピーは作らない。
- キー変更/削除時はbackground内のin-flight要求をAbortし、結果を無効化。monitorへ秘密を含まない変更通知を送り`credentialsChanged(available)`で停止する。worker内でもキー世代/再読取により遅延結果が新設定に混ざらないようにする。
- coreのAbortSignalはIPCでserializeできない。統合adapterはrequest IDとcancel messageへ変換し、worker側のAbortControllerへ接続する。worker終了時の応答欠落も固定networkへ変換する。
- API host permissionはGoogle APIに限定。worker内setTimeoutの常時ポーリング/keepaliveは行わない。20秒の一回要求タイムアウトは常時監視タイマーではない。offscreen/alarms/native host/独自サーバーは追加しない。
- popupは既存monitorを再利用する。background内で取得を直列化し、trusted `chrome.storage.session`へbinding、直近interval、notBeforeを保持する。キー/本文はsessionに保存しない。monitor再読込、worker再作成、別動画選択でもcooldownを短縮しない。通信前に最低25秒または直近intervalの長い方のleaseを書き、workerが途中終了した場合も早すぎる再取得を防ぐ。正常な応答後は指定interval/Retry-Afterへ更新する。

Chrome公式はworkerが30秒の無活動、fetch応答待ち30秒等で終了し得ると説明している。恒久監視をworker global state/timerだけに置かない。

## coreのinterface

`src/youtube/contracts.ts`:
- `Result<T>`は`{ ok: true, value: T }`または`{ ok: false, error: ChatError }`。
- `ChatMessage`: YouTubeのmessage `id`、`text`（snippet.displayMessage）、`authorChannelId`（authorDetails.channelId）、任意の`authorDisplayName`（authorDetails.displayName）、`type`。アプリ永続化IDではない。名前は表示用であり、IDによる照合やJev判定の入力には使わない。未取得名は「名前不明」と表示する。
- `ChatPage`: `messages`, `nextPageToken`, `pollingIntervalMillis`, `ended`。
- `ChatError`: 列挙code、固定日本語message、任意retryAfterMillisのみ。provider error.message/body/生URL/キー/例外causeは返さない。

`createYouTubeClient(fetcher?)`（trusted background用）:
- `resolveVideo(videoId, apiKey, signal): Promise<Result<{liveChatId}>>`
- `listMessages(liveChatId, pageToken | undefined, apiKey, signal): Promise<Result<ChatPage>>`
- 固定Google endpointへcredentials omit/cache no-store/redirect errorでGET。全要求を20秒でAbort。APIキーは要求だけに使用し、戻り値やlogに含めない。

`createChatMonitor({transport, onMessages, onState, now?})`（monitorページ用）:
- transportは`resolveVideo(videoId, signal)`と`listMessages(chatId, pageToken, signal)`。キーを扱わない。
- `setVideo(string | undefined)`: 別動画へ変わると停止/Abortし、cursorと既処理IDをクリア。同じIDの通知では変更しない。
- `credentialsChanged(available: boolean)`: 削除/差替えとも停止/Abortしcursorをクリア。falseでは開始不可。trueでも自動再開しない。同じ動画の既処理IDは保持。
- `start()`: 設定確認済み・有効動画IDのときだけ明示開始。連打は無視。
- `stop()`: 待機timerを除去しAbort。世代で古い応答を隔離。
- onStateはstopped/running/error/ended。onMessagesは新IDの表示内容を持つメッセージのみ。

## 取得・停止規則

- 一回ずつ取得し、応答完了後に待機する。未完了の古い要求がある間は再開後も並行callしない。
- 既定のアプリ最小間隔は5000ms（YouTubeの既定値ではない）。直近pollingIntervalMillisとの長い方を尊重。エラー後/停止後/動画・キー変更後もcooldownを短縮しない。失効世代の遅延応答でも指定待機を反映する。
- 全APIエラーで自動再試行せず停止する。明示再開はcooldown満了まで待つ。429/503のRetry-Afterは秒数とHTTP-dateを解釈し、既定/直近間隔より長ければ優先する。
- nextPageToken、正の安全整数pollingIntervalMillis、items配列、message ID/type/hasDisplayContentを必須とする。表示メッセージの本文/投稿者IDが欠けると不正応答として全ページを拒否。silent eventは本文/投稿者を要求せず通知しない。
- IDは同一ページ/ページ間/同じ動画の停止再開を通じて重複通知しない。既処理IDはmonitorインスタンス内に保持し、別動画で解放する。永続化/全履歴復元はない。gift等の同ID更新も再通知しない。
- offlineAtまたはchatEndedEventで終了し、最終ページを通知して停止する。
- 動画items空はnotFound（非公開・取得不能でも空になり得る。削除と断定しない）。liveStreamingDetailsなし/開始前はnotLive、actualEndTimeありはended、実開始済みでactiveLiveChatIdなしはchatDisabled（取得できるチャットなし）。APIのliveChatDisabled/liveChatEnded/notFoundを個別に分類する。
- quota/auth/forbidden/network/rateLimited/unavailable/invalidResponseも個別code。汎用403をキー不正とは断定しない。
- 初回listは直近の一部履歴であり、過去全履歴を保証しない。古いメッセージを遡って取得できる設計ではない。

## 利用者設定と未検証事項

利用者自身のGoogle Cloud projectでYouTube Data API v3を有効化し、公開データ用APIキーと利用quotaを用意する。API restrictionはYouTube Data API v3へ限定する。モデレーター権限や配信管理用OAuthをこの機能のために要求しない。Chrome extensionからの要求とキーのapplication restriction（HTTP referrer/IP等）の組合せは実環境で確認が必要。Webサイト用referrer設定がそのまま機能すると断定しない。キーやキー付きURLをスクリーンショット/logへ出さない。

実キーは参照/出力/使用していない。公開ライブチャットのlist APIキー認証成功、Google側クォータ消費、キー制限の適合性、streamList実接続は未検証。Issueの「APIキー認証を実確認」は未達であり、fixtureで代替達成したとは報告しない。

## 検証の境界

- unit: fetch fixtureとfake clockでレスポンス分類、固定エラー、token、interval、Retry-After、停止/Abort/遅延/動画・キー変更/明示再開を確認。
- `e2e/youtube-core.spec.ts`: 実ChromiumへMV3を読み込み、テスト専用trusted `fixture.html`で本coreをbundleしてexercise。Google APIへの要求はPlaywright routeでfixtureへ置換。継続、token継承、間隔、重複、停止、quota/不正応答、textContent表示を確認。
- このテスト専用ページ・host permissionは一時コピーにだけ追加し、dist/配布zipには含めない。キーは架空のfixture文字列。
- `e2e/youtube-monitor.spec.ts`: production distを実MV3へ読み込み、options→credential-store→popup→monitor→background→API fixtureの経路を確認。OSのツールバー操作ではなくCDP Extensions.triggerActionで実Chrome actionを呼びactiveTabをgrantする。Chrome action popup targetはPlaywright Pageでないため、同じproduction popupを非activeの拡張タブでexerciseする。この制約を通常Chromeの手動確認済みとは扱わない。
- 同E2EでYouTube視聴タブを前面にした継続、token継承、指定interval下限、重複ID、textContentによる安全な表示、明示停止、キー削除/再設定と自動再開なし、quota/不正応答で停止と固定文言、optionsから取得拒否、動画遷移で再選択を確認。Google要求はすべてPlaywright routeでAPI fixtureに置換し、実キー/実APIは使わない。
- worker再作成のsession cooldown継承、偽sender/query付きURL/別monitor tabの拒否、キー変更時Abortと遅延応答の隔離はhandler unitで検証。YouTube取得中の実worker強制終了、複数monitorの実ブラウザ競合、実Chrome手動操作、実長時間throttlingの測定は未検証。pagehide/closeの停止はproductionで実装しているが、このE2Eでは明示停止と動画遷移を検証対象とした。
- 限定race修正後の最終 `npm run package` はunit 80件、実Chromium E2E 16件、strict typecheck、build、zip生成が成功（exit 0）。従来のunit 76件／E2E 12件を削除せず、handler 4ケース／monitor初期化4ケースを追加。#2の未送信入力保持回帰を含む既存テストを維持している。

## 独立reviewの限定race修正

修正範囲はbindingの競合とmonitor初期statusの競合だけ。API方式、権限、クォータ・interval、キー契約、取得機能は追加・変更していない。親のstage済み実装を基準に、追加修正はstage/commit/pushせずissue-3 worktreeのworking treeに残す。

- binding: API要求の直列化queueと別に、生成・削除・liveChatId更新で共有する状態queueを設けた。targetChangedはawaitより前に対象in-flightをAbortするため、状態I/OやAPI応答待ちでAbortが遅れない。新bindingの書込完了時と対象削除時にbinding世代を更新し、古いイベント・要求結果は世代一致を要求する。liveChatIdは同じ状態排他内で最新bindingを照合して書き、書込後もAbort/世代を再確認する。
- handler RED→GREEN: 新openMonitorのbinding書込をpromiseで保留し、旧targetChangedの読取と交差させると新bindingがundefinedになった（exit 1）。共通排他修正でGREEN。同じtabの動画再選択もREDで確認し、世代切替を新binding書込完了へ移してGREEN。
- handler RED→GREEN: resolveのliveChatId書込をpromiseで保留して対象削除と交差させると、旧bindingが復活した（exit 1）。liveChatId更新も共通状態排他へ入れてGREEN。別回帰ではAPI応答を保留したまま即時Abort・対象削除・同じ動画の再選択を完了し、旧世代のAPI結果が新bindingに入らないことを確認した。
- monitor: trustedなtargetChanged/credentialsChanged通知で初期化世代を進め、世代が一致する初期status応答だけを反映する。古い成功応答も失敗応答も通知後の状態・説明を上書きしない。
- monitor RED→GREEN: `e2e/monitor-initialization.spec.ts` はproduction dist/monitor.jsを実Chromiumで読み込む。初期statusのpromise応答とtrusted通知配送だけをテスト制御し、targetChangedとcredentialsChangedそれぞれの後に古い成功/失敗応答を解放する。修正前は開始が再有効化、または説明が上書きされた（各通知で2 failures、exit 1）。通知世代と応答/catchの一致判定後は4ケースGREEN。実API経路の検証ではなく、UIの競合順序を固定した検証である。

実キーは使用せずsynthetic/fixtureだけで検証した。実API認証・Google側クォータ消費が未確認であることは、このrace修正後も変わらない。

追加確認: `npx playwright test e2e/monitor-initialization.spec.ts --repeat-each=3 --retries=0` は4ケースを各3回実行し12成功（exit 0）。`git diff --check` と `git diff --cached --check` はexit 0。実zipは13,821 bytes／allowlistの9エントリだけで、全エントリがdistとbyte一致することを確認した。新しいrace用テストページやharnessは配布物へ追加していない。

## 公式一次資料

- list契約・間隔・初回履歴・エラー: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/list
- streamList・再接続・web/gRPCエラー: https://developers.google.com/youtube/v3/live/docs/liveChatMessages/streamList
- native gRPC/HTTP2サンプル・APIキー/OAuth: https://developers.google.com/youtube/v3/live/streaming-live-chat
- videos.list: https://developers.google.com/youtube/v3/docs/videos/list
- liveStreamingDetails: https://developers.google.com/youtube/v3/docs/videos#liveStreamingDetails
- resource fields: https://developers.google.com/youtube/v3/live/docs/liveChatMessages
- API有効化・公開データ・quota: https://developers.google.com/youtube/v3/getting-started
- quota calculator: https://developers.google.com/youtube/v3/determine_quota_cost
- extension origin fetch/host permission: https://developer.chrome.com/docs/extensions/develop/concepts/network-requests
- worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- activeTab: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
- session storage: https://developer.chrome.com/docs/extensions/reference/api/storage
