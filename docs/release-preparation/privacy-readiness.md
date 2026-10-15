# プライバシーポリシーの公開準備チェック

確認日：2026-10-08（日本時間）
状態：利用者向けポリシーはGitHub mainに掲載済みの案で、正式施行・規約適合・一般配布の保証はない。以下は文書整備時点の記録・未達auditであり、当時の「未公開」「未反映」の記載を現在の掲載状態やコード・利用確認UIの実装状況と混同しない。
Issue #27で全配信の非表示データ削除UI・停止と世代隔離を追加し、その説明をコードと照合した。正式施行・規約適合・提供元承認を意味しない。

[利用者向けポリシー案](../privacy.md) ／ [既存の規約確認記録](../policy-review.md) ／ [提供元への問い合わせ文案](provider-inquiries.md)

## Issue #30：開発版の規約案・明示同意導線

- [利用規約案](../terms.md)は一般利用者向けの短い文書とし、監査論点や調査Sourcesはこのチェック側に分離する。施行日未定・正式施行ではない状態を、privacy・設定画面・同梱規約で一致させる。
- `src/confirmation-panel.ts`の既存panelに規約リンクと明示同意checkboxを置き、「同意を保存」で保存する。`CONFIRMATION_VERSION = 2`とし、literalの旧版1は取得・保存とも拒否して自動移行しない。未同意・旧版・読取失敗・保存失敗でYouTube取得／Jev送信を開始せず、同意だけでは通信を開始しない。キー保存や既存非表示の表示制御まで遮断する変更ではない。
- mainの新しい規約URLは未マージ時に404となるため、スクリプト不要の`public/terms.html`を既存buildの静的copyで`dist/terms.html`へ同梱し、設定UIから`runtime.getURL('terms.html')`で開く。zipも明示allowlistへ追加する。公開用MarkdownとHTMLの本文・リンクの一致をテストする。新しい初回画面、ライブラリ、汎用Markdown変換器、manifest権限やCSPの変更はない。
- [MetaMask公式公開ソース](https://github.com/MetaMask/metamask-extension/blob/5272c5962b2db55aba00d91a06bbe735df7f6644/ui/pages/onboarding-flow/welcome/welcome.js)に、初期falseの規約checkbox、規約リンク、未チェック時の作成／インポートボタン無効化、進む操作で同意日時を保存する実装がある。これは調査時のdevelop上の対象ファイルの最終変更commitを固定した参照で、現ストア配布版の画面は未実測。[v11.0.0の同ファイル](https://github.com/MetaMask/metamask-extension/blob/v11.0.0/ui/pages/onboarding-flow/welcome/welcome.js)は旧版の実装例として区別する。公式の規約掲載だけをUI確認の証拠にしない。他拡張の契約内容・自動同意条件を本拡張へ転用しない。
- [Chrome Disclosure Requirements](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements)は、扱うデータと用途の目立つ開示、affirmative and informed consent、インストール前の開示・同意と変更時の開示を要求する。[Chrome FAQ §10](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)は規約・privacyだけへの説明埋め込みでは足りず、製品UIでデータ処理前の明確な同意操作を求める。既存送信説明をcheckboxより前に維持するが、本実装だけでインストール前の要件や同意前のキー保存の適合まで完了とはしない。
- [YouTube Developer Policies III.A](https://developers.google.com/youtube/terms/developer-policies)は自前の規約でYouTube規約への拘束を説明・リンクし、機能利用前のprivacy同意、目立ち常時アクセス可能な開示を求める。API gateの回帰はこの用途の全面的な適合性の証明ではなく、既存非表示・キー保存等も含む適用範囲は公開前に照合する。
- 準拠法・裁判所・年齢・配布価格・賠償上限・全面免責・リバースエンジニアリング禁止など未承認の契約条件は規約案に設定しない。数値判定項目は規約本文へ重複せず、privacy／onboardingへ委ねる。提供元の用途適合、第三者の権利・送信同意、長期保存、暗号化、Limited Use等の既存未達事項は引き続き未達。
- `tests/background.test.ts`、共通E2E確認fixture、同意・通信境界・popup再起動の回帰を版2へ整合し、literal1の旧版拒否を保持する。文書テストと`e2e/terms-consent.spec.ts`で未チェック、同梱規約を実際に開くこと、安全リンク、送信説明→checkbox→保存のDOM順を確認する。実API・本人の通常Windows Chromeでの確認は別。

以下の「この作業」「今回」は従来のprivacy整備時点の記録。Issue #30の変更・検証範囲は上記と子担当の実行結果で区別し、過去の未公開・親によるpackage予定を現在の状態と取り違えない。

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
| local非表示 | `hiddenAuthors.<video ID>`内の`ids`、`displayNames`、`revisions`。安定channel IDで照合し、登録時の既取得名を保存。名前がない旧データは名前不明。明示解除まで保持・自動期限なし | `src/hidden-authors/store.ts`、`src/youtube/background-handler.ts` |
| 解除後のlocal | 個別解除では投稿者IDをキーとする`revisions`と空recordが残る。設定の「全配信の非表示データを削除」で全`hiddenAuthors.`項目をremoveしreadback検証する。APIキー・threshold・他local・API待機期限は保持。非表示情報に10000件の技術上限や30日期限を適用していない | `src/hidden-authors/store.ts`、`src/hidden-authors/options.ts` |
| session対象binding | `youtube.monitorBinding`：monitorTabId、targetTabId、videoId、解決済みならliveChatId。対象変更・対象タブ/monitor終了でbindingを除去する経路がある | `src/youtube/background-handler.ts` |
| session待機期限・停止制御 | `youtube.cooldown`：interval/notBefore。通信前leaseと応答のinterval/Retry-Afterに従う。`jev.notBefore`：Jev再開を制限する期限。全削除では両方保持し、`hidden.collectionPaused`をtrueにする。worker再作成後も旧listは停止し、新しい明示resolve成功でのみ解除する。キー・本文・評価結果をsessionに入れない | `src/youtube/background-handler.ts`、`src/jev/moderation.ts:45-47,79-81` |
| 判定用メモリ | 同一投稿者・投稿時刻で対象以前60秒以内、対象込み最大20件。時刻のみの連投根拠は本文の20件窓と分離。Jev停止と取得停止は別で、取得停止は本文を解放、対象変更等ではreset | `src/jev/history.ts:6-7,27-38,49-65`、`src/jev/moderation.ts:27-32` |
| 一時Map | 追加から60000ms。期限は重複読取/書込で延長しない。通常10000件の上限、期限超過のsweepとtimerで解放 | `src/retention.ts:2-49`、`src/youtube/monitor.ts:21,60-63` |
| 待機操作・判定 | 共通操作queueは実行中込み200件の受付制限、待機は60秒で期限切れ。backend判定もpending200件。UIは待機200件のMapと別の実行中1件で、全体を常に200件と同一視しない | `src/retention.ts:54-75`、`src/jev/moderation.ts:24-25,109-118`、`src/jev/monitor.ts:32-47` |
| 監視画面 | 最大200行。古い行はDOM/判定待ちから除去するが、直近の画面表示を60秒で消すものではない。停止でも表示済み行は残り得る | `src/monitor.ts`、`src/jev/monitor.ts:112-116` |

一時メモリ、通信中のスナップショット、DOM、session、localは別の寿命。タイマーの実行が遅れる場合もあるため、すべてのコピーが60秒ちょうどに消えるとは書かない。Chromeのsession領域の消去と、workerの再作成も区別する。

全配信削除はexact options URL・同一拡張ID・typeだけのIPCに限定する。backgroundの全配信epochとstoreのqueue epochをawait前に失効し、遅い取得／Jev／登録／名前更新／個別解除で旧データが書き戻る経路を遮断する。送信済み情報の取消ではない。監視画面は停止通知と一覧更新、YouTubeの全iframe/popoutは既存hidden.listの1秒定期更新で復元する。削除失敗やreadback残存は成功にしない。判定用のメモリはresetするが表示済み本文の一括消去ではない。

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
- [ ] **YouTube API由来情報の長期保存・削除要求**：III.E.4の30日以内の削除／更新や削除要求に対する7暦日以内等の要件と、期限なしの動画ID・非表示ID・表示名・解除revisionの関係を確認する。全配信削除UIは追加したが、個別解除のrevision残存、開発者による遠隔削除不可も対象。一括削除UIだけで要件充足や規約適合と判断しない。30日自動削除・定期refreshは現在実装しておらず、今回勝手に追加しない。[7]
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
