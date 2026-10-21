# 配信別の投稿者リスト保存・解除（Issue #40後）

## 現在の範囲と承認境界

公式API取得、Jev判定、既取得コメントによるローカル連投判定から、配信別の投稿者リストへ保存する。monitorは監視開始・停止、保存一覧の確認と解除までを担当する。Issue #40でYouTubeへのcontent/MAIN注入とDOM変更を完全撤去した。YouTube本体の表示・操作を変更せず、拡張内のコメント非表示・閲覧UI改修も未実装（Issue #41）。「非表示」は既存の保存key・管理UI名称であり、現行の表示適用を意味しない。BAN、投稿、コメント削除、追加履歴APIは使わない。

実YouTube Data API・実Jevへの接続は未検証。YouTubeの派生データ、表示変更、30日保持等の利用条件との適合は保留であり、実API利用・公開配布を許可済みとは扱わない。現在の保存契約と判定数値は承認済み仕様の実装であり、規約適合の証明ではない。規約調査を理由とした保存期間・数値ルールの変更は行っていない。

## 非表示対象と停止・解除

- 非表示リストの単位はYouTubeの配信video ID。同じ投稿者でも別videoへ登録を持ち越さない。
- 登録根拠は、backgroundで取得済みIDに対して確定したJevの`malicious=true`、または既取得コメントによるローカル連投の確定結果だけ。API/判定失敗、未判定、判定待ちを悪質扱いしない。
- いずれかのraw noul評価値 `>= 評価開始時の設定threshold`（初期中0.8／高0.65／低0.9、詳細0〜1 inclusive）で悪質と判定する。設定変更は新評価だけに適用し、in-flight/cachedは評価時thresholdを維持する。既存非表示IDは設定変更で自動解除せず、過去コメントを再Jev送信しない。同一投稿者の10秒以内10件以上、Jev文脈60秒以内・対象込み最大20件の規則は変更していない。詳細は [jev-moderation.md](jev-moderation.md) と [filter-settings.md](filter-settings.md)。
- 監視停止は取得・判定の停止。monitor close、キー変更・削除、worker/browser再起動でもリストを勝手に消さない。旧ID-onlyデータも読み取る。今回の更新に伴うデータ削除・移行はない。
- 一覧は現在選択したvideoのみ。別videoを確認・解除する場合は、そのwatch/liveタブをpopupから選び直す。全videoの管理画面ではない。
- 明示解除は対象videoの保存IDを除く。monitorの一覧更新は1秒間隔で、timer throttling等により遅れる場合がある。YouTubeページへの定期更新・表示変更はない。
- 解除前に取得・保持していた結果や進行中判定は、解除revisionの不一致により即再登録できない。解除後の新しい観測が改めて悪質なら、再登録できる。永久許可リストではない。

## 保存するもの・解除で残るもの

backgroundの`src/hidden-authors/store.ts`だけが`chrome.storage.local`を操作する。保存keyは`hiddenAuthors.<video ID>`、値は`{ ids: string[], revisions: Record<string, number>, displayNames?: Record<string, string> }`。既存のID-only recordもそのまま読み、一覧を読むだけでは書き換えない。

- `ids`: その配信の保存済みYouTube channel ID一覧。表示への適用は未実装。
- `revisions`: authorごとの解除世代。未記録は0として扱い、解除時に増加する。観測時に捕捉したrevisionと登録時のrevisionが一致する場合だけ登録できる。
- `displayNames`: 非表示IDに紐づく既取得のYouTube表示名。公式`liveChatMessages.list`の`authorDetails.displayName`だけを利用する。既存requestは`part=id,snippet,authorDetails`、`fields`指定なしで、名前のための追加APIは使わない。登録時に名前を保存し、同じIDの取得済み名前が変わったときだけ更新する。欠落・不正な名前では既知の名前を消さない。
- 取得コメントと下部の非表示投稿者一覧は名前を主表示にし、補足の「投稿者ID」を開くと内部IDを確認できる。未取得名・ID-only recordは「名前不明」と表示し、推測やAPI補完をしない。同名でも照合・解除は安定したchannel IDによって個別に行う。解除ボタンのaria-labelにも名前とIDを含める。
- 名前更新もrevision/current世代を照合し、未登録IDの名前更新から非表示を新規登録しない。遅い判定の登録には同一video/author/revision/collectionに属する保持中の最新取得名を使い、cached判定から既存の名前を戻さない。名前と取得順は既存の60秒の観測Map内だけに保持し、TTLや件数上限を変更しない。
- 解除後は`ids`と`displayNames`から対象を除くが、video/authorに紐づくrevision metadataはlocalに残る。リストが空でも保存record自体は削除しない。「非表示解除」は当該投稿者に関する保存データの完全消去ではない。
- 設定の独立カード「全配信の非表示データを削除」は、確認・キャンセルを経て全`hiddenAuthors.`項目（ID・名前・revision・空record）を削除する。APIキー・threshold・他localとAPI待機期限は残す。取得・判定を停止し、全配信epochとstore queue epochで古い取得／判定／登録／名前更新／個別解除を失効させる。実行中writeは完了を待ってから削除し、readbackで残存があれば失敗とする。hidden.clearing/hidden.refreshは拡張monitorの停止・一覧更新に必要な通知であり残す。YouTubeへの通知・反映はない。明示再開後の新しい取得・判定は通常動作する。
- 自動期限、30日削除、同期、キー削除への連動消去は実装していない。全配信削除UIにより利用条件の保留を解消したとは扱わない。
- 本文、DOM本文、message ID履歴、判定結果全体はこのstoreへ保存しない。表示名だけを表示用metadataとして保存し、非表示コメントarchiveは追加しない。sync/Web localStorageは使わない。名前はJevのtarget/historyへ送らず、判定やidentity判断にも使わない。
- キー用の`initializeCredentialStorage()`と同じ`TRUSTED_CONTEXTS`gateをawaitしてからlocalを読み書きする。contentからlocalを直接読むことは許可しない。

観測ID/author/revision/collection世代の対応付けはworkerメモリ内。同一bindingでの既取得message IDは旧観測として扱うが、worker再起動を跨ぐmessage IDの重複排除は永続化していない。再起動後の公式初回取得が過去の投稿を含む場合、その再取得は新規観測となり得るため、「解除した過去のmessageが再起動後も絶対に再判定されない」とは保証しない。非表示IDと解除revisionの保持、本文/履歴・opt-inの非復元は別の契約である。

## 責務と安全IPC

- `src/youtube/background-handler.ts`: 公式list結果の観測ID、video、author、revision、collection世代を対応付ける。判定結果と同じ観測authorであること、binding/collection世代、対象タブURLを照合して登録する。
- `src/jev/moderation.ts`: #4の判定。ローカル連投確定をobserveの戻り値としても返し、Jev通信待ちや未有効化とは独立して登録へ進める。
- `src/hidden-authors/store.ts`: 配信別保存、登録のrevision/current判定、解除の直列化。
- `src/hidden-authors/handler.ts`: 非表示一覧と解除のsender/payload/video境界。
- `src/hidden-authors/monitor.ts`: 対象videoの一覧、解除、対象変更による旧UI応答の無効化。


許可されたmonitorへの成功応答は`{ ok: true, videoId, ids, authors: { authorChannelId, displayName? }[] }`。拒否は`{ ok: false }`。キー、他videoの一覧、revision全体を応答へ載せない。UIはvideo/ID/名前の形状と対応を検証し、名前・IDを`textContent`で描画する。YouTube listのIPCも任意の名前を含む取得message形状を検証する。

monitorの`hidden.list`はtype/videoIdの2フィールド、`hidden.remove`はtype/videoId/authorChannelIdの3フィールドだけ。同一拡張ID、完全一致のmonitor URL、sessionのmonitor tab binding、対象videoと現在watch/liveタブURLの一致を要求する。

旧content用の`hidden.list`（type/videoId/referrer）応答とchatVideo/referrer照合を撤去した。旧contentからの一覧要求も固定拒否する。外部sender、他URL、別video、不正/余分payloadも拒否する。取得やJevのIPCは引き続きauthorized monitor専用。

## YouTube非介入と更新

YouTubeのページ・プレイヤー・ライブチャット・リプレイへのcontent/MAIN注入、DOM照合・監視・定期反映・CSS変更を撤去した。manifest宣言だけでなくソース、build entry、ZIP allowlistとYouTube originのhost権限も除去する。`storage`、対象選択と現在動画URL照合の`activeTab`、Google/TypeSafe APIへのhost権限のみ残す。activeTabでのURL参照はページへの介入ではない。

動的注入、オーバーレイ、標準チャットの自動閉鎖・ブロック自動クリック、非公開API、本文スクレイピングによる代替はしない。

旧版の注入済みタブは拡張更新だけでは旧スクリプト・非表示スタイルが残り得る。拡張更新後、視聴ページ（iframeの親）、popout、リプレイを含むYouTubeの全タブを再読み込みするか閉じて開き直す。保存データの削除は不要。過去のDOM実測は [旧版#5の検証記録](verification/issue-5.md) として残すが現行機能の実績にはしない。

## 停止raceと検証

取得要求はbinding読取前にcollection世代を捕捉し、成功したlist結果を観測へ渡す直前、revision取得await後、登録前でも世代/Abortを確認する。停止・キー変更・動画変更の後に返る旧YouTube応答を、停止後の新規観測・ローカル連投登録へ使わない。第三contextの限定修正と独立再レビューの受領経緯、縦RED→GREEN、fixtureと実DOMの区別、実測は [verification/issue-5.md](verification/issue-5.md) を参照。
