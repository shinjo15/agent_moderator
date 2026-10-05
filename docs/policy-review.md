# 公式一次資料の確認・公開前の保留条件

確認日：2026-10-05（JST）。Issue #6独立調査。認証不要の公式ページを直接読んだ記録で、実キー・ログイン済みConsole・通常ブラウザprofileは参照していません。法的適合性の承認ではありません。

## 結論：公開配布可とは断定しない

YouTube API由来コメントのJev評価／連投判定、本人画面のチャット非表示、API由来IDの解除までの保持には重大な確認事項があります。YouTubeの一般禁止条項があり、個別用途の適合性／承認は未確認です。親へ早期報告済みです。文書で許可を捏造したり、合意ルールを無断変更したりしません。

「AI学習禁止」と「外部AIでの推論利用可否」は別です。読んだYouTube Terms／Developer PoliciesでAI推論を名指しして本用途を許可する条項は確認できず、学習と推論を同一扱いして全面禁止／全面許可とも断定しません。派生データ・表示変更・第三者権利の規定から個別判断が必要です。[1][2]

公式Guideは適合性が不明ならAPI Compliance Auditを申請し、用途とend usersを明記するよう案内しています。Guideは同意なしのfilterを禁止する例、単純数学のacceptable metrics例も示しますが、それはJevで悪質度を生成する本用途の許可ではありません。Guide末尾は追加派生metrics／保持の特例を、明示申請し承認されたanalytics用途に限っています。本プロジェクトにその承認がある根拠はありません。[22]

申請・公開・外部への問い合わせ送信は本作業では行いません。公開前に親が公式確認方法と対応範囲を判断してください。通常PRと公開配布は別で、実API未測定だけを理由にDraftへ変更する方針ではありません。

## YouTubeの重要条項：原文と本用途との関係

### API Services Terms of Service

- **§2.1 The Agreement / §3.1 Compliance with the Agreement**：Developer Policiesを含むAgreementへの遵守が必要。機能を「本人画面だけ」と説明すれば免除される条項は確認していません。[2]
- **冒頭 API Data定義**：API servicesを通じて提供されたdata、content、informationがAPI Dataです。ライブチャット本文・投稿者IDを「公開情報だから無制限利用可」と扱えません。[2]
- **§7 User Privacy and API Clients**：公開したprivacy policyでアクセス・収集・保存・利用・処理・共有の理由を正確に説明する必要があります。[2]
- **§11 Proprietary Rights Notices**：著作権表示・author attribution・由来の表示等を除去／変更しない規定です。非表示UIの作者リンク／表示の扱いを確認する必要があります。[2]
- **§12 Third-Party Rights**：第三者の知的財産、機密、プライバシー等の権利を侵害しない。外部送信が許可されるかは閲覧者のopt-inだけで決まりません。[2]
- **§15 Usage and Quotas**：利用制限を超過／回避してはなりません。自前キー方式が、同一用途を複数projectへ分割してquotaを回避する運用を促さないことも確認事項です。[2][22]
- **§16.2 No Other Rights**：Agreementに明示されたもの以外の権利／licenseは与えられない。AIへの送信・学習について未記載であることを許可と解釈しません。[2]

### Developer Policies — III.E. Handling YouTube Data and Content

**III.E.4.h（派生データ）**：[1]

> Your API Clients must not (i) replace API Data with similar, independently calculated data, or (ii) access or use API Data to create new or derived data or metrics.

Jevの悪質性評価値と判定理由はAPI由来コメントからの新しい判定データです。ローカル連投もAPI由来時刻・IDから計算します。これらにこの禁止が適用されるかは重大条件で、推論だから学習でない、外部AI表示と明示した、という理由だけでは適合を証明しません。[1]

**III.E.4.d（Non-Authorized Dataの保存）**：[1]

> API Clients may temporarily store limited amounts of Non-Authorized Data for as long as is necessary for the purposes of the API Client but not longer than 30 calendar days.

続く文は30日後に削除またはrefreshが必要と記載します。#5実装はvideoID別のリストを解除まで保持し、解除後もrevision metadataと空recordが残ります。[実際の保存契約](local-author-filter.md) ユーザーの非表示設定そのものと、その中のAPI由来ID／metadataを分けて確認する必要があります。「全部ユーザー設定だからAPI Dataでない」「localなら対象外」「キー所有者の同意で投稿者のAuthorized Dataになる」と断定しません。30日自動削除・refreshの実装を#6で勝手に足しません。[1]

**III.E.4.g（削除要求）**：利用者がstored data削除を要求したらできる限り早く、7暦日以内に削除する必要があります。拡張側の削除がYouTube側のデータ削除とは違うことも明示する規定です。第三者送信済みデータの削除／保持を含め、公開前に照合する必要があります。[1]

### Developer Policies — III.I. Additional Prohibitions

**III.I.4（表示・機能変更）**：[1]

> modify, interfere with, replace, or otherwise disable any functionality, data, or content made available as part of, or in connection with, YouTube API Services.

原文はplayer／API Data内リンクのremove／obscure／alter／disableも例示します。#5のローカルDOM非表示はBANや投稿削除とは別ですが、本人の明示解除可能なfilterだから必ず例外になるとは読めません。player・広告へ作用しないこととは別に、チャット行・投稿者リンクの扱いを確認します。[1]

**III.I.3 / III.I.14**：YouTube Applications等の正常動作への干渉や、API Services以外の技術でAPI Dataを取得することも禁止します。#5でDOMをID照合と表示に使うことと、DOMからチャット本文を取得してAPI代わりにすることを混同しません。本用途への適用／境界は未確認です。[1]

### Developer Policies — III.A. API Client Terms of Use and Privacy Policies

YouTube利用規約リンク、利用により拘束されることの説明、機能利用前のprivacy policy同意、Google Privacy Policyへのリンク、取得／保存／第三者共有／削除の説明等が求められます。現在のキー設定／Jev opt-inがすべてを満たすとは確認していません。READMEの文書追加だけで同意UI要件が満たされたとは扱いません。[1]

## TypeSafe：公式キー・料金・入力データ処理

### Quick start — Call it: the API

公式HTML版はキー管理へ `https://console.typesafe.ai/settings/keys`、Markdown版は `https://console.typesafe.ai/keys` を案内しています。両方を直接読み、差異を残しました。ログイン後画面の発行／取消ボタン名や請求画面は未確認です。[15][16]

### API reference — Evaluation endpoint / Request body / Errors

`POST https://api.typesafe.ai/v1/systemone`、Bearer、`state`、`model: jev-latest`、`questions`、noulの0〜1 yes値を確認しました。これは通信契約であり、実モデル速度・精度・日本語分類性能や支払成功の証明ではありません。[6]

### Home — 料金表示

> Per Billion input tokens.

見出しは **$42** です。第三者gatewayの価格とは混同しません。実請求単価、税、credit残高、自動補充、各利用者のOrderは未確認です。広告の比較速度／コストや「Zero Hallucinations」を本拡張の実測／保証にしません。[5]

### Terms of useとMaster customer agreementの区別

SiteのTerms of use冒頭は、別契約で製品／サービスを使う場合はその別契約が適用されると記載します。これだけをAPIサービスの全契約と扱わず、API／Web Interfaceを対象にするMCAも直接読みました。[4][20]

- **MCA §2.2 Customer Applications / §5 Customer Obligations**：アプリへの統合は契約・Documentation・法令・第三者権利の遵守が前提。Inputの権利・通知・同意をCustomerが確保する必要があります。[20]
- **MCA §4.1 Use of Customer Data**：契約履行、料金計算、Telemetry生成、不正・悪用監視、法令対応の処理を規定。学習datasetへ入れない条件は “without Customer’s prior consent” です。[20]
- **MCA §4.3 Telemetry / §10.3 Effect of Termination**：technical logs、hashes、summary statistics and classifications等のTelemetryを扱うこと、標準backupに情報が残り得ることを記載。推論後即時削除ではありません。[20]
- **MCA §8.2 Credits / §8.4 Taxes**：Inputごとのcredit消費、Orderに別指定がなければPurchased Creditの有効期限、opt-inした自動補充、税別等を規定。無料枠や月額上限が常にあると推測しません。[20]

### Privacy — Services / Retention / International Visitors

> We will not train or fine tune any artificial intelligence or machine learning models on your prompts or other Input.

これは公開Privacyの記載です。一方MCAは事前同意例外のある学習条項を持つので、利用者の契約との関係を確認します。「学習利用はすべて未知」とも「全プランで一切例外なし」とも書きません。[3][20]

> We retain personal data about you for as long as reasonably necessary to provide you with the Services, or otherwise in support of our business or commercial purposes.

固定のAPI入力ログ保持日数・ゼロ保持は不明です。Privacyは米国での保存・処理を説明します。Inputの学習利用、推論処理、ログ保存、Telemetry利用、backupはそれぞれ区別します。[3]

### Data processing addendum — §2 / Schedule I §8

DPAは個人データの処理目的／Documented Instructions／役割と国際移転を定めます。保存は目的・法令に照らした必要期間で、固定日数はありません。Privacy／MCA／DPAを合わせても、実利用者のAPI入力即時消去やzero data retentionは確認できていません。[21]

### Acceptable Use Policy — §1.1 / §1.2

権利侵害、違法contentのupload／process／storeを禁じています。悪質投稿の検知という目的だけで、違法contentを含む実チャットを一律外部送信できる例外を確認したわけではありません。必要な入力権利、子供の情報、センシティブ情報と、モデレーション用途の取り扱いは公式確認が必要です。[17]

## Chrome MV3・Chrome Web Storeの要件

| 公式見出し | 確認した要件・引用 | 本拡張での境界 |
| --- | --- | --- |
| Hello World extension — Load an unpacked extension / Pin the extension / Reload the extension | デベロッパーモード→Load unpacked、固定、更新時再読み込み [7] | 手順へ反映。通常Windows Chromeでの手動確認とは別 |
| Updated Privacy Policy & Secure Handling Requirements — FAQ 3 / 6 / 14 | “even when data is processed or stored locally” でも開示、privacy policy掲載が必要 [8] | localキー／リスト／本文と外部送信を説明。掲載・申請は未実施 |
| 同FAQ — 9 / 10 | 保存時強固な暗号化の記述、目立つ説明とUI内の具体的同意行為が必要 [8] | 現在のlocalキー保存を暗号化秘密保管庫と偽らない。保存時保護の適合と同意UIを要確認 |
| Limited Use — 2 / 3 / 5 / 6 | 開示目的へ限定、単一目的に必要な情報、第三者移転・人の閲覧の制限、遵守宣言 [9] | 外部AIが必要な単一目的か、providerの処理／人の閲覧と整合するかを確認。未達の遵守宣言を捏造しない |
| Use of Permissions — 1 | “Request access to the narrowest permissions necessary” [10] | 現行manifestは `storage`、`activeTab`、Google／TypeSafe APIおよび `https://www.youtube.com/*` のhost permission。YouTube origin全体への権限は現在タブURL照合用であり、chat pathだけへの権限制限ではない。MAIN/isolated注入はchat URL限定。[#5契約](local-author-filter.md)。この構成の規約適合は未確認 |
| Handling Requirements — 2 / 4 | modern cryptographyでの通信、認証情報を安全にし公開しない [18] | 固定HTTPSとキー非表示／非同梱。local保存だけで全要件完了とは扱わない |

## 親が判断／確認する残事項（未達）

- [ ] YouTube派生データ禁止とJev悪質性／連投判定の関係について公式確認。
- [ ] ローカルチャット非表示、投稿者リンク等の変更、DOM照合が各禁止条項に適合するか公式確認。
- [ ] 非表示設定とAPI由来IDを分離し、解除までの保持と30日削除／refresh義務の関係を確認。合意仕様の無断変更なし。
- [ ] API DataをTypeSafeへ送る権利、投稿者の個人情報、利用者自身opt-in以外の同意要件を確認。
- [ ] TypeSafe個別Order／MCA／Privacy／DPAと実入力ログ保持日数、backup、学習事前同意例外、zero retention可否を確認。
- [ ] Chrome保存時保護・UI内同意・YouTube利用規約／Privacyリンク・帰属表示・最小権限を最終UIと照合。
- [ ] 公開時の正式privacy policyとストア申告／Limited Use宣言が実装・provider契約と一致することを確認。

本作業ではストア申請、YouTube audit申請、TypeSafeへの実Input送信を行っていません。#5統合と自動テスト成功でも上記規約確認を代替しません。

## Sources

[1] https://developers.google.com/youtube/terms/developer-policies
[2] https://developers.google.com/youtube/terms/api-services-terms-of-service
[3] https://typesafe.ai/legal/privacy-policy
[4] https://typesafe.ai/legal/terms
[5] https://typesafe.ai
[6] https://docs.typesafe.ai/api
[7] https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world
[8] https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
[9] https://developer.chrome.com/docs/webstore/program-policies/limited-use
[10] https://developer.chrome.com/docs/webstore/program-policies/permissions
[15] https://docs.typesafe.ai/introduction/quickstart
[16] https://docs.typesafe.ai/introduction/quickstart.md
[17] https://typesafe.ai/legal/acceptable-use-policy
[18] https://developer.chrome.com/docs/webstore/program-policies/data-handling
[20] https://typesafe.ai/legal/mca
[21] https://typesafe.ai/data-processing
[22] https://developers.google.com/youtube/terms/developer-policies-guide
