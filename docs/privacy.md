# プライバシー・送信データ・削除の説明

Issue #6独立作業版。#4までの実装と、未統合の#5合意仕様を区別しています。公開配布向けの最終プライバシーポリシー／同意UIの完成や規約適合性を証明する文書ではありません。[導入手順](onboarding.md) ／ [一次資料と公開前の確認事項](policy-review.md)

## 外部通信と目的

独自バックエンドはありませんが、オフラインではありません。利用者の端末の拡張backgroundから、GoogleのYouTube Data APIへチャット取得、明示opt-in後にTypeSafeのJev APIへ悪質性の推論要求を送ります。独自収集サーバー、広告・アクセス解析、モデル学習のための送信は実装していません。

| 宛先 | 送る情報 | 目的・時点 |
| --- | --- | --- |
| Google `https://www.googleapis.com/youtube/v3/videos` | 利用者のYouTubeキー、videoID、取得項目等 | 明示取得開始時のliveChatId解決 |
| Google `https://www.googleapis.com/youtube/v3/liveChat/messages` | 利用者のYouTubeキー、liveChatId、ページtoken、取得項目等 | 開いているmonitorでの継続取得。追加履歴APIではない |
| TypeSafe `https://api.typesafe.ai/v1/systemone` | Authorizationヘッダーの利用者のJevキー、model、固定7項目questions、targetとhistoryの本文・投稿時刻 | Jev明示有効化後の新着判定。1件ずつ直列。停止／エラーで外部判定通信停止 |

キーは認証通信に必要です。「ID・キーを送らない」という説明はJevの投稿stateの範囲のことです。Googleには取得対象IDとキーを、TypeSafeには認証ヘッダーでJevキーを送ります。通信先はIPアドレス等の接続メタデータも受け取り得ます。TypeSafeはPrivacy「Device Information」「Usage Information」でIP、ブラウザ、OS、利用日時等の受領を記載しています。[3]

Jevの投稿stateは対象本文＋任意の投稿時刻、既取得同一投稿者の対象以前かつ60秒以内の文脈（対象込み最大20件）の本文と投稿時刻だけです。message ID、authorChannelId、videoID、他投稿者の履歴は入れません。追加の履歴API、失われた本文の再取得はしません。7項目を1回のquestionsにまとめます。[実装契約](jev-moderation.md)

ID欄を除いても本文に氏名、住所、連絡先、攻撃内容等が含まれ得ます。本文の自動匿名化／個人情報マスキングは実装しておらず、他人の投稿を外部へ送る権利・同意の確認は別途必要です。視聴者自身のJev opt-inだけで投稿者の同意を取得したことにはなりません。YouTube Terms §12とTypeSafe MCA §5は第三者の権利を侵害しないこと／必要な権利・同意・通知の確保を求めます。[2][20]

## 端末内で扱う情報

| 情報 | 保存・保持場所 | 保持／消去 |
| --- | --- | --- |
| Jev／YouTube APIキー | 拡張専用 `chrome.storage.local`（trusted contextへ制限） | providerごとの明示削除または拡張削除まで。Chrome同期なし |
| #5非表示リスト | 合意は配信別videoIDの `chrome.storage.local` | 明示解除まで保持、同期なし。キー削除・取得停止とは独立。具体フィールドと実動作は#5親commit後に確認 |
| #4の判定用本文・時刻履歴 | background workerメモリ、動画／monitor binding session単位 | 本文は60秒窓・投稿者ごと最大20件。時刻だけの連投根拠は分離。取得停止・対象変更等で解放。storageへの本文永続化なし |
| 取得重複ID・評価対応／結果 | monitor／workerメモリ | session／対象変更等で解放。worker終了で失われるものがあり、永続履歴や全配信復元はしない |
| monitorに表示した本文・評価 | 開いているmonitorのページDOM | ページの表示は判定用60秒窓とは別。取得停止だけで表示済み本文をすべて消す保証ではなく、monitorを閉じる／再読み込みする |
| binding・取得待機期限・JevのRetry-After期限 | trusted `chrome.storage.session` | Chrome session内の制御情報。キー・本文は保存しない。cooldownを短縮しないためworker再作成でも利用 |

`chrome.storage.local` は暗号化された秘密保管庫ではありません。パスワード入力は覗き見抑制にすぎません。trusted context制限はYouTube content scriptからのキー読取を防ぐ境界ですが、端末所有者／profileへアクセスできる人を防げません。本拡張はキーの独自暗号化を実装していません。公開前にはChrome Web Storeの保存時保護の要件も別途確認します。[8]

拡張は `chrome.storage.sync`、Web localStorage、独自サーバーへの保存を行いません。端末／OS側のバックアップや提供元の保存まで禁止・削除できる意味ではありません。

## TypeSafeでの保存と学習を分ける

- Privacy「Services」には “We will not train or fine tune any artificial intelligence or machine learning models on your prompts or other Input.” と記載されています。Inputを学習／fine tuningに使わないという公開の記載を確認しました。[3]
- API契約のMCA §4.1は、Customer Dataをモデルのweightsを変更する学習datasetへ入れないことを、**Customerの事前同意なし**という条件で規定しています。個別Order／Separate Agreementの条件を確認する必要があり、全契約で例外なく絶対に学習されないとは保証しません。[20]
- 推論要求を送ることと、モデル学習に使うことと、サーバーに保存することは別です。学習しないことはゼロ保持を意味しません。
- Privacy「Retention」は “for as long as reasonably necessary” とし、固定日数・推論後即時削除・ゼロ保持を約束していません。「International Visitors」は米国での保存・処理を記載します。[3]
- MCA §4.1は契約履行／料金計算のほかTelemetry生成、不正・悪用監視、法令対応の処理を認め、§4.3はtechnical logs、hashes、summary statistics and classifications等のTelemetry処理を説明します。§10.3は標準backupにCustomer Confidential Informationが残り得ることを記載しています。[20]
- DPA §2は個人データをServicesとDocumented Instructionsに従って処理する規定、Schedule I §8は目的と法令に照らした必要期間という保存基準です。これにも固定保持日数はありません。[21]
- 正確なAPI入力／応答ログの日数、backup消去日、ゼロ保持の利用可否、利用者の個別契約は未知です。TypeSafeへ確認するまでは「保存されない」「完全匿名」「学習も保存もない」と書きません。

TypeSafe PrivacyはInputをサービスプロバイダー以外の第三者へ開示しないとも記載しますが、法令対応等の開示条項やMCA／DPAを合わせて読む必要があります。送信済みInputの消去は拡張から保証できません。[3][20][21]

## 削除・停止はそれぞれ独立

1. Jev送信だけ停止する：monitorの「Jev判定を停止」。YouTube取得は別です。
2. 取得と判定を停止する：「取得を停止」、monitorを閉じる等。#5合意では非表示と永続リストは維持します。
3. 非表示を解除／リストを削除する：#5統合後、配信別一覧から対象を明示解除。存在している行の表示を復元します。キーは消しません。具体UIは統合待ちです。
4. キーを拡張内から削除する：設定画面でproviderごとの「キーを削除」。もう一方のキーや非表示リストとは独立です。
5. 提供元キーを失効する：Google Cloud／TypeSafe Consoleで別途削除・取消・ローテーション。拡張内の削除は提供元での失効ではありません。
6. 全ローカルデータを削除する：取得停止後、Chrome拡張一覧からアンインストール。Chrome公式ではlocalは拡張削除で消去されます。履歴／キャッシュ消去だけではlocalは消えません。[19]
7. 送信済みデータや契約を削除／解約する：提供元へ別途依頼。TypeSafe Privacyの連絡先は `privacy@typesafe.ai`、MCAのsupportは `support@typesafe.ai`。保持例外・backup・既存請求を含め提供元に確認してください。[3][20]

この拡張の停止・解除・キー削除・アンインストールは、YouTube上の投稿削除／BAN／Googleアカウント削除ではありません。送信済みデータや課金履歴は巻き戻しません。

## 必要権限と公開前の残事項

現在のmanifestは `storage`（キー・制御状態）、`activeTab`（利用者が選ぶ視聴タブ）、Google／TypeSafeの限定API host permissions、YouTubeチャットURL限定content scriptを使います。#5によるcontentの非表示責務・権限の最終説明はそのcommit確認後に確定します。

Chrome Web Storeでは、ローカル保存のみでもユーザーデータの扱いを開示し、プライバシーポリシーを掲載する必要があります。追加の目立つ説明／UI内同意、Limited Useの遵守宣言、Developer Dashboard申告と実装の一致、安全な保存、最小権限を確認する必要があります。Markdownを追加しただけでは申請要件達成ではありません。[8][9][10]

YouTube Developer Policies III.Aは利用者へのYouTube利用規約リンク／拘束の説明、機能アクセス前のプライバシーポリシー同意等を求めます。公開前にUI・同意フローを別途照合します。コード変更や規則変更をIssue #6の文書だけで代替しません。[1]

## Sources

[1] https://developers.google.com/youtube/terms/developer-policies
[2] https://developers.google.com/youtube/terms/api-services-terms-of-service
[3] https://typesafe.ai/legal/privacy-policy
[8] https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
[9] https://developer.chrome.com/docs/webstore/program-policies/limited-use
[10] https://developer.chrome.com/docs/webstore/program-policies/permissions
[19] https://developer.chrome.com/docs/extensions/reference/api/storage
[20] https://typesafe.ai/legal/mca
[21] https://typesafe.ai/data-processing
