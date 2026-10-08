# Issue #5: 配信別の投稿者ローカル非表示

## 現在の範囲と承認境界

公式API取得、Jev判定、既取得コメントによるローカル連投判定を、視聴者本人の画面の非表示へつなぐ。monitorは監視開始・停止に加え、対象配信の非表示投稿者一覧の確認と解除までを担当する。YouTubeへのBAN、投稿、コメント削除、追加履歴APIは使わない。

実YouTube Data API・実Jevへの接続は未検証。YouTubeの派生データ、表示変更、30日保持等の利用条件との適合は保留であり、実API利用・公開配布を許可済みとは扱わない。現在の保存契約と判定数値は承認済み仕様の実装であり、規約適合の証明ではない。規約調査を理由とした保存期間・数値ルールの変更は行っていない。

## 非表示対象と停止・解除

- 非表示リストの単位はYouTubeの配信video ID。同じ投稿者でも別videoへ登録を持ち越さない。
- 登録根拠は、backgroundで取得済みIDに対して確定したJevの`malicious=true`、または既取得コメントによるローカル連投の確定結果だけ。API/判定失敗、未判定、判定待ちを悪質扱いしない。
- いずれかのraw noul評価値 `>= 評価開始時の設定threshold`（初期中0.8／高0.65／低0.9、詳細0〜1 inclusive）で悪質と判定する。設定変更は新評価だけに適用し、in-flight/cachedは評価時thresholdを維持する。既存非表示IDは設定変更で自動解除せず、過去コメントを再Jev送信しない。同一投稿者の10秒以内10件以上、Jev文脈60秒以内・対象込み最大20件の規則は変更していない。詳細は [jev-moderation.md](jev-moderation.md) と [filter-settings.md](filter-settings.md)。
- 監視停止は取得・判定の停止。登録済み投稿者の既存・新着非表示は続く。monitor close、キー変更・削除、worker/browser再起動でもリストを勝手に消さない。
- 一覧は現在選択したvideoのみ。別videoを確認・解除する場合は、そのwatch/liveタブをpopupから選び直す。全videoの管理画面ではない。
- 明示解除は対象videoの非表示IDを除き、contentの定期更新で既存・新着へ反映する。content/monitorの更新は1秒間隔だが、バックグラウンドのtimer throttling等により反映が遅れる場合があり、厳密な即時反映は保証しない。
- 解除前に取得・保持していた結果や進行中判定は、解除revisionの不一致により即再登録できない。解除後の新しい観測が改めて悪質なら、再登録できる。永久許可リストではない。

## 保存するもの・解除で残るもの

backgroundの`src/hidden-authors/store.ts`だけが`chrome.storage.local`を操作する。保存keyは`hiddenAuthors.<video ID>`、値は`{ ids: string[], revisions: Record<string, number>, displayNames?: Record<string, string> }`。既存のID-only recordもそのまま読み、一覧を読むだけでは書き換えない。

- `ids`: その配信で非表示にするYouTube channel ID一覧。
- `revisions`: authorごとの解除世代。未記録は0として扱い、解除時に増加する。観測時に捕捉したrevisionと登録時のrevisionが一致する場合だけ登録できる。
- `displayNames`: 非表示IDに紐づく既取得のYouTube表示名。公式`liveChatMessages.list`の`authorDetails.displayName`だけを利用する。既存requestは`part=id,snippet,authorDetails`、`fields`指定なしで、名前のための追加APIは使わない。登録時に名前を保存し、同じIDの取得済み名前が変わったときだけ更新する。欠落・不正な名前では既知の名前を消さない。
- 取得コメントと下部の非表示投稿者一覧は名前を主表示にし、補足の「投稿者ID」を開くと内部IDを確認できる。未取得名・ID-only recordは「名前不明」と表示し、推測やAPI補完をしない。同名でも照合・解除は安定したchannel IDによって個別に行う。解除ボタンのaria-labelにも名前とIDを含める。
- 名前更新もrevision/current世代を照合し、未登録IDの名前更新から非表示を新規登録しない。遅い判定の登録には同一video/author/revision/collectionに属する保持中の最新取得名を使い、cached判定から既存の名前を戻さない。名前と取得順は既存の60秒の観測Map内だけに保持し、TTLや件数上限を変更しない。
- 解除後は`ids`と`displayNames`から対象を除くが、video/authorに紐づくrevision metadataはlocalに残る。リストが空でも保存record自体は削除しない。「非表示解除」は当該投稿者に関する保存データの完全消去ではない。
- 自動期限、30日削除、同期、キー削除への連動消去、revisionを完全消去する専用UIは実装していない。利用条件の保留をこの実装で解消したとは扱わない。
- 本文、DOM本文、message ID履歴、判定結果全体はこのstoreへ保存しない。表示名だけを表示用metadataとして保存し、非表示コメントarchiveは追加しない。sync/Web localStorageは使わない。名前はJevのtarget/historyへ送らず、判定やidentity判断にも使わない。
- キー用の`initializeCredentialStorage()`と同じ`TRUSTED_CONTEXTS`gateをawaitしてからlocalを読み書きする。contentからlocalを直接読むことは許可しない。

観測ID/author/revision/collection世代の対応付けはworkerメモリ内。同一bindingでの既取得message IDは旧観測として扱うが、worker再起動を跨ぐmessage IDの重複排除は永続化していない。再起動後の公式初回取得が過去の投稿を含む場合、その再取得は新規観測となり得るため、「解除した過去のmessageが再起動後も絶対に再判定されない」とは保証しない。非表示IDと解除revisionの保持、本文/履歴・opt-inの非復元は別の契約である。

## 責務と安全IPC

- `src/youtube/background-handler.ts`: 公式list結果の観測ID、video、author、revision、collection世代を対応付ける。判定結果と同じ観測authorであること、binding/collection世代、対象タブURLを照合して登録する。
- `src/jev/moderation.ts`: #4の判定。ローカル連投確定をobserveの戻り値としても返し、Jev通信待ちや未有効化とは独立して登録へ進める。
- `src/hidden-authors/store.ts`: 配信別保存、登録のrevision/current判定、解除の直列化。
- `src/hidden-authors/handler.ts`: 非表示一覧と解除のsender/payload/video境界。
- `src/hidden-authors/monitor.ts`: 対象videoの一覧、解除、対象変更による旧UI応答の無効化。
- `src/content-ids.ts`: MAIN側のrenderer識別のみ。Chrome API、キー、非表示一覧、本文取得・外部送信は扱わない。
- `src/content.ts`: isolated側で対象videoのID一覧だけを受け取り、rendererの表示を変更・復元する。

contentへの非表示IPC成功応答は従来どおり`{ ok: true, videoId, ids }`、許可されたmonitorへの成功応答だけ`authors: { authorChannelId, displayName? }[]`を加える。拒否は`{ ok: false }`。キー、他videoの一覧、revision全体を応答へ載せない。UIはvideo/ID/名前の形状と対応を検証し、名前・IDを`textContent`で描画する。YouTube listのIPCも任意の名前を含む取得message形状を検証する。

monitorの`hidden.list`はtype/videoIdの2フィールド、`hidden.remove`はtype/videoId/authorChannelIdの3フィールドだけ。同一拡張ID、完全一致のmonitor URL、sessionのmonitor tab binding、対象videoと現在watch/liveタブURLの一致を要求する。

contentの`hidden.list`はtype/videoId/referrerだけ。同一拡張ID、`https://www.youtube.com/live_chat`のフレームURL、要求video、現在sender.tab.idのタブURLを照合する。contentからの登録・解除、外部sender、他URL、別video、不正/余分payloadは拒否する。外部message listenerも要求を拒否する。取得やJevのIPCは引き続きauthorized monitor専用で、contentに本文や生キーを渡して評価させない。

## 実DOMのIDとvideo照合

実YouTubeのtext-message rendererでは、MAINの`renderer.data.authorExternalChannelId`にUC形式のchannel IDを観測した。isolatedでは同じrendererの`data`expandoは見えない。観測したHTML属性に直接のchannel IDはなく、配下リンクhrefは`#`だった。表示名/handleから照合しない。

MAIN→isolatedのブリッジはrendererをevent targetとし、JSON文字列の`{ messageId, channelId }`だけをCustomEventで渡す。本文を収集せず、isolatedはtargetのrenderer種別、message IDとDOMのidの一致、channel ID形式を確認する。MAINへキーや非表示リスト全体を公開しない。これはYouTubeページ側データへの依存であって、そのデータが将来も不変である保証や、ページ側の改変に対する認証手段ではない。

- 通常watchのiframe: 実URLは`/live_chat?continuation=...`でvを持たない場合がある。isolatedはdocument.referrerのwatch/live videoを使い、backgroundが現在タブURLを再照合する。古いreferrerを現在videoの保証として単独で信じない。continuationは推測decodeしない。
- popout: 実URLの`v`と現在のタブURLを照合する。referrerは空でもよい。
- 動画が識別できない、不一致、許可外URLの場合は非表示一覧を適用しない。旧videoのリスト応答はcontentの世代・現在videoチェックで反映しない。

#5で追加済みのYouTube host permissionはこの現在タブURL照合のため。activeTab許可のないpopoutではタブURLが返らないことをfixtureで実測した。host permissionはYouTube origin全体であり、pathをチャットだけの権限制限とみなさない。`storage`/`activeTab`以外のpermissions、tabs/scripting/offscreen、全サイト権限は追加していない。MAIN/isolatedの注入matchesはチャットURL限定で、watch本体へ注入しない。

## 表示処理、MAIN依存と対応範囲

既存DOMを走査し、新着・id変更をMutationObserverで確認する。MAINは属性変化を伴わないPolymer data変更も500ms間隔で確認する。isolatedはmessage IDとnodeの一致を確認して、対象IDにだけinline `display: none !important`を設定し、解除時は保存した元のdisplay値/priorityを戻す。node再利用時は新しいID情報に従い再評価する。

IDが得られない新規rendererは表示を残す（fail-open）。MAINの未実行、ページ側JavaScript/DOM変更、未知rendererでは非表示を保証しない。MAINが停止した瞬間に既識別情報を一斉破棄して全nodeを表示へ戻す仕組みではなく、既に識別されたnodeに古い識別情報が残る可能性もある。安全な秘密保護のfail-closedと、表示フィルターのfail-openは別の境界である。

- 対応URLの実処理は`/live_chat`だけ。`/live_chat_replay`は注入宣言のmatchesには含まれるが、video解決境界で拒否し、replay非表示は未対応。
- 実装selectorはtext-message、paid-message、paid-sticker、membership-itemの4種。
- 実YouTube DOMの非表示/復元を確認したのはtext-messageのみ。残り3種の実描画、gift/system/banner等の他renderer、全chat種別や将来DOM変更は検証済みとしない。
- DOMは非表示の識別・表示制御に限定する。コメント取得・判定は公式API由来を維持し、DOM本文をJevへ送らない。

## 停止raceと検証

取得要求はbinding読取前にcollection世代を捕捉し、成功したlist結果を観測へ渡す直前、revision取得await後、登録前でも世代/Abortを確認する。停止・キー変更・動画変更の後に返る旧YouTube応答を、停止後の新規観測・ローカル連投登録へ使わない。第三contextの限定修正と独立再レビューの受領経緯、縦RED→GREEN、fixtureと実DOMの区別、実測は [verification/issue-5.md](verification/issue-5.md) を参照。
