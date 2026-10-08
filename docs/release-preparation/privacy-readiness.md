# プライバシーポリシーの公開準備チェック

確認日：2026-10-08（日本時間）
状態：利用者向けポリシーはGitHub mainに掲載済みの案で、正式施行・規約適合・一般配布の保証はない。以下は文書整備時点の記録・未達auditであり、当時の「未公開」「未反映」の記載を現在の掲載状態やコード・利用確認UIの実装状況と混同しない。

[利用者向けポリシー案](../privacy.md) ／ [既存の規約確認記録](../policy-review.md) ／ [提供元への問い合わせ文案](provider-inquiries.md)

## 1. この作業で整備した範囲

- 一般利用者向けの取得・送信・保存・停止・解除・削除の説明を、現在の実装に合わせた。
- YouTube API Servicesの使用、YouTube利用規約への拘束とリンク、Google Privacyへのリンクを本文へ記載した。
- ユーザーから公開用の記載承認を得た連絡先 `shinjo0015@gmail.com` を案に記載した。問い合わせや削除要求の操作支援と、端末内データの遠隔削除ができないことを区別した。
- 日付は`date '+%Y-%m-%d %Z'`の実結果に基づく。最終更新日と未確定の施行日を分けた。実利用開始日を作っていない。
- 正式施行・公開承認・規約適合・同意取得・Limited Use certificationが完了したという宣言はしていない。
- この改訂のstage・commit・push・公開、ストア登録、問い合わせ送信はしていない。既存の公開URLにはこの案をまだ反映していない。

## 2. 実装と照合したデータ一覧

以下は保存内容の型・保存項目をsourceから確認した記録であり、実ユーザーのstorageやAPIキーを読み取ったものではない。

| 保存・保持 | 現在のデータ／寿命 | 照合先 |
| --- | --- | --- |
| localキー | `apiKey.youtube`、`apiKey.jev`。provider別の保存・削除。空欄保存は既存値保持。local全体を`TRUSTED_CONTEXTS`に制限するが独自暗号化なし | `src/credential-store.ts:12-51`、`src/background.ts:56-83` |
| local判定設定 | `moderation.threshold`。新評価開始時の値を使用し、その評価結果に付随する値と現在設定を混同しない。キー削除で設定を消さない | `src/jev/settings.ts:4-33`、`src/jev/moderation.ts:63-89` |
| local非表示 | `hiddenAuthors.<video ID>`内の`ids`、`displayNames`、`revisions`。安定channel IDで照合し、登録時の既取得名を保存。名前がない旧データは名前不明。明示解除まで保持・自動期限なし | `src/hidden-authors/store.ts:10-56`、`src/youtube/background-handler.ts:149-159,213-233` |
| 解除後のlocal | 対象の非表示IDと名前を削除するが、投稿者IDをキーとする`revisions`と空recordは残る。非表示情報に10000件の技術上限や30日期限を適用していない | `src/hidden-authors/store.ts:50-56` |
| session対象binding | `youtube.monitorBinding`：monitorTabId、targetTabId、videoId、解決済みならliveChatId。対象変更・対象タブ/monitor終了でbindingを除去する経路がある | `src/youtube/background-handler.ts:20-22,60-93,103-122,208` |
| session待機期限 | `youtube.cooldown`：interval/notBefore。通信前leaseと応答のinterval/Retry-Afterに従う。`jev.notBefore`：Jev再開を制限する期限。キー・本文・評価結果をsessionに入れない | `src/youtube/background-handler.ts:185-201`、`src/jev/moderation.ts:45-47,79-81` |
| 判定用メモリ | 同一投稿者・投稿時刻で対象以前60秒以内、対象込み最大20件。時刻のみの連投根拠は本文の20件窓と分離。Jev停止と取得停止は別で、取得停止は本文を解放、対象変更等ではreset | `src/jev/history.ts:6-7,27-38,49-65`、`src/jev/moderation.ts:27-32` |
| 一時Map | 追加から60000ms。期限は重複読取/書込で延長しない。通常10000件の上限、期限超過のsweepとtimerで解放 | `src/retention.ts:2-49`、`src/youtube/monitor.ts:21,60-63` |
| 待機操作・判定 | 共通操作queueは実行中込み200件の受付制限、待機は60秒で期限切れ。backend判定もpending200件。UIは待機200件のMapと別の実行中1件で、全体を常に200件と同一視しない | `src/retention.ts:54-75`、`src/jev/moderation.ts:24-25,109-118`、`src/jev/monitor.ts:32-47` |
| 監視画面 | 最大200行。古い行はDOM/判定待ちから除去するが、直近の画面表示を60秒で消すものではない。停止でも表示済み行は残り得る | `src/monitor.ts:74-94`、`src/jev/monitor.ts:112-116` |

一時メモリ、通信中のスナップショット、DOM、session、localは別の寿命。タイマーの実行が遅れる場合もあるため、すべてのコピーが60秒ちょうどに消えるとは書かない。Chromeのsession領域の消去と、workerの再作成も区別する。

### 外部通信の照合

- YouTube：`videos`と`liveChat/messages`。キーは要求の認証用query。listのpartは`id,snippet,authorDetails`で、表示名も既存の応答から取り込む。補完APIなし。`src/youtube/client.ts:40-43,74-81,96-103`。
- Jev：固定HTTPSエンドポイント `https://api.typesafe.ai/v1/systemone` へ、利用者のJev APIキーを使ったAuthorizationヘッダーによるBearer認証で送信する。bodyは`model`、`state`、固定`questions`。`state.target/history`に含める投稿データは本文と任意の投稿時刻のみで、投稿者ID・表示名・動画ID・コメントIDは含めない。認証用キーの送信と投稿データの最小化は別。根拠：`src/jev/client.ts:13-17`、`src/jev/history.ts:6-7,27-33`。
- 双方`credentials: 'omit'`、`cache: 'no-store'`、固定HTTPS。これは独自暗号化・提供元ゼロ保持・全セキュリティ要件への適合を意味しない。
- 本文の個人情報自動マスキングはない。有効化ボタンは投稿者本人の同意を取得するものではない。

## 3. 公開前に解消・判断する事項（未達）

以下は公開可と断定できない条件。文書ができたことでチェックを完了にしない。実装変更が必要になった場合は、内容・影響を説明して承認を得る。

- [ ] **公開URL・施行日**：正式な公開先、開発者表示、施行日を確定し、公開内容を新稿へ更新する。匿名で閲覧可能な内容と拡張／配布ページからのリンクを読み戻し、旧版を参照していないことを確認する。現在の案は未公開。
- [ ] **YouTube利用前の案内と同意**：Developer Policies III.Aの規約リンク／拘束説明、Privacyの明示とアクセス容易性、機能利用前の同意導線を実UIで照合する。今回の文書内リンクや既存のキー保存／Jev有効化だけで全部対応済みとしない。OAuthを使用していない現方式と認可取消の要件適用も確認する。[7]
- [ ] **目立つ開示とUI内同意**：第三者送信する情報・目的、権利・通知・投稿者本人の同意、子供やセンシティブ情報を含む入力を確認する。Chromeの目立つ説明は文書だけで代替できない。[4][8]
- [ ] **YouTube API由来情報の長期保存・削除要求**：III.E.4の30日以内の削除／更新や削除要求に対する7暦日以内等の要件と、期限なしの動画ID・非表示ID・表示名・解除revisionの関係を確認する。解除後のrevision残存や一括消去UIがない点も対象。開発者による遠隔削除不可・アンインストール案内だけで要件充足と判断しない。30日自動削除・定期refreshは現在実装しておらず、今回勝手に追加しない。[7]
- [ ] **派生判定・画面変更・自前キー方式**：YouTubeの派生データ／指標、API Dataの表示・リンク変更、視聴者本人の非表示、第三者へのAI推論送信、各利用者自身のAPIキー配布方式に関する確認を進める。提供元から本用途の承認を得たとは扱わない。[7]
- [ ] **TypeSafeの入力・出力・ログ・バックアップ**：具体的な保持日数、削除手続、担当者／委託先の閲覧、Telemetryの利用、個別Order、学習の事前同意条件、ゼロ保持の利用可否、DPA/国際移転を確認する。Privacyに学習しない旨があることと、MCAの事前同意条件、保存が別であることは今回も確認したが、利用者の個別条件は未知。[3][4][5]
- [ ] **保存時保護**：現状のtrusted context制限と暗号化していないlocalキー保存を、Chrome Web Storeの保存時保護要件と照合する。独自暗号化や秘密保管庫だと表示していないことだけで適合としない。[8]
- [ ] **Limited Useとストア申告**：実装・外部サービス条件・人の閲覧・データ移転・最小権限・単一目的・公開説明を照合した後に、必要な遵守宣言やDashboard certificationを判断する。未確認の認証や遵守保証をポリシーに書かない。[8][9]
- [ ] **問い合わせ運用**：承認された公開メールの対応担当、問い合わせメールの具体的な保存・消去方針、必要な法令対応・バックアップの扱いを確定する。端末内データの操作支援、開発者が受け取った問い合わせ、Google／TypeSafe送信済み情報を区別する。返信期限や提供元の消去を捏造・保証しない。

詳細な規約論点と問い合わせ内容は[既存の確認記録](../policy-review.md)と[問い合わせ文案](provider-inquiries.md)を参照する。本作業では問い合わせを送信していない。ユーザーはTypeSafeへ送信済みと明言しており、問い合わせ全体を未送信とは扱わない。本作業では回答の受領状況や公開承認の有無を確認・判断していない。

## 4. 文書の検証範囲

既存の`tests/documentation.test.ts`に加え、`tests/privacy-documentation.test.ts`で案・日付、規約／提供元リンク、連絡先、保存と解除後残存、送信範囲、保持と学習の未知部分、削除と操作支援、audit分離とローカルリンクを回帰対象にする。

文書テストは内容の欠落を防ぐためのもの。法律判断・提供元承認・実API実績・正式な同意取得を検証するものではない。`npm run package`と配布物の全体検証は親が単独で実行する。

## Sources

[3] https://typesafe.ai/legal/privacy-policy
[4] https://typesafe.ai/legal/mca
[5] https://typesafe.ai/data-processing
[7] https://developers.google.com/youtube/terms/developer-policies
[8] https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
[9] https://developer.chrome.com/docs/webstore/program-policies/limited-use
