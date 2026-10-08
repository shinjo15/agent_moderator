# 日本語導入手順

## 先に確認すること

この手順はIssue #5統合済みの版を対象にします。非表示の実装境界は [#5技術契約](local-author-filter.md)、fixtureと実DOMの検証範囲は [#5検証記録](verification/issue-5.md)、今回の文書統合後の検証は [#6検証記録](verification/issue-6.md) を参照してください。

併せて [プライバシー・送信データ・削除](privacy.md) と [公式一次資料・公開前の保留条件](policy-review.md) を読んでください。

公開配布の適合性は未確認です。YouTube API Dataからの判定値生成、画面内非表示、API由来IDの保持に重大な規約確認事項があります。本人画面だけ・本人キー・明示有効化であっても、規約上許可されたとは限りません。規約確認前の実API利用や一般配布を推奨する手順ではありません。

- 対象はYouTube Liveの一般視聴者の画面です。他の視聴者の画面や配信全体には作用しません。
- BAN・YouTube投稿削除・投稿・モデレーター権限取得は永久に対象外です。非表示はYouTubeからの削除ではありません。
- 独自バックエンド不要はオフライン動作という意味ではありません。チャット取得にはGoogle、Jevを有効化した判定にはTypeSafeへの外部通信が必要です。
- 自分のGoogle CloudとTypeSafeアカウント／APIキーを用意します。開発者のキーは配布しません。
- 実キーの認証、通常Windows Chrome、実モデル精度、長時間運用は未検証です。#5では隔離Chromiumの実YouTube DOMでtext-messageの非表示・復元をlocal seedで確認しましたが、実API経由の登録は未確認です。API fixtureの値は実モデルの予測ではありません。

## 1. Chromeへ読み込む

### ビルドする場合

Node.js 24 LTS以上とnpmを用意し、プロジェクトのフォルダーで次を実行します。キーをファイルやコマンドに書く必要はありません。

```sh
npm ci
npm run build
```

`dist/` が拡張機能本体です。自動検証は開発者向けに [README](../README.md) のコマンドを使います。配布zipを受け取った場合は、先に専用フォルダーへ展開し、その直下に `manifest.json` があることを確認します。ソースフォルダーやzipそのものは選びません。

### Chromeで開発読み込みする

1. Chromeのアドレスバーに `chrome://extensions` を入力します。
2. 「デベロッパーモード」を有効にします。
3. 「パッケージ化されていない拡張機能を読み込む」を押し、`dist/`（zipなら展開先）を選びます。
4. Agent Moderatorが一覧に出ることを確認します。
5. パズル形の拡張機能メニューから固定し、ツールバーにアイコンを出します。
6. 詳細画面の「拡張機能のオプション」またはpopupの設定リンクで設定画面を開きます。

この読み込み・固定は公式「Hello World extension」の「Load an unpacked extension」「Pin the extension」に基づきます。[7]

WSLでビルドした場合は、Windowsのエクスプローラーから参照できる `dist/` をフォルダー選択してください。通常Windows Chromeでのこの手順は本作業では未実施です。更新時は再ビルド→拡張一覧の再読み込み→YouTubeページも再読み込みしてください。公式はcontent script変更に拡張とホストページの両方の再読み込みが必要と説明しています。[7]

## 2. Google CloudでYouTubeキーを発行する

以下は公式資料の手順です。実アカウントでの画面操作／接続成功は未検証です。

1. 自分のGoogleアカウントでGoogle Cloud Consoleを開き、利用するプロジェクトを作成または選択します。
2. 「APIとサービス」のライブラリで「YouTube Data API v3」を探して有効化します。公式「Before you start」はGoogleアカウント、プロジェクト、APIの有効化を要件としています。[11]
3. 「APIとサービス」→「認証情報」→「認証情報を作成」→「APIキー」で標準APIキーを作成します。サービスアカウントに紐付けたauthorization keyやOAuth client secretを、この拡張のYouTubeキー欄へ入れないでください。[13]
4. キー編集でAPIの制限を「YouTube Data API v3」へ限定します。API制限とアプリケーション制限は別です。[14]
5. アプリケーション制限（HTTP referrer、IP等）はChrome拡張originからの要求と適合する設定を別途確認します。通常のWebサイト向けreferrerやYouTubeのURLを設定すれば動く、と断定しません。制限不一致では要求が拒否されます。無制限キーを安全な解決策として勧めません。[14]
6. Cloud Consoleで、このプロジェクトのAPIクォータ上限・使用量を確認します。[11][12]
7. コピーしたキーを拡張の「YouTube APIキー」欄へ貼り、「YouTubeキーを保存」を押します。キーをチャット、Issue、スクリーンショット、ログ、ソース、`.env`、zipへ貼りません。

拡張は配信管理OAuthやGoogleログインパスワードを要求しません。APIキーによる公開ライブチャット取得成功はまだ未実測で、ここをチェック済みにはしていません。

## 3. TypeSafe公式のJevキーを発行する

1. TypeSafe公式Quick startのPlayground／Consoleリンクから自分のアカウントでログインします。[15]
2. 公式ConsoleのAPI key管理で新しいキーを発行します。公式HTML版は `https://console.typesafe.ai/settings/keys`、公式Markdown版は `https://console.typesafe.ai/keys` を案内しており差があります。利用中Consoleのキー管理画面に従ってください。ログイン後の具体的な発行ボタン名・取消手順は未確認です。[15][16]
3. 課金・credit残高・自動補充の有無・契約条件をConsoleで確認します。Jevは有料APIです。キー発行だけで無料・無制限と考えないでください。Master customer agreement §8ではInput送信によるcredit消費と、利用者がopt-inした自動補充を説明しています。[20]
4. 「Jev APIキー」欄へ貼り、「Jevキーを保存」を押します。

本拡張の接続先は `https://api.typesafe.ai/v1/systemone`、認証はBearer、モデル指定は `jev-latest` です。別事業者のgatewayキーや他のAIサービスのキーとは区別してください。[6]

## 4. 保存結果を確認する

- providerごとの表示が「設定済み」になればローカル保存状態を確認できています。接続確認はしないので、認証成功・credit・利用可能クォータの保証ではありません。
- 保存済みキーの文字列はUIへ戻しません。保存後に入力欄が空になるのは想定動作です。
- 空欄で「保存」は既存キーを保持します。削除は必ずproviderの「キーを削除」を使います。
- キーはこの拡張専用の `chrome.storage.local` に保存します。Chrome同期・Web localStorageは使いません。暗号化された秘密保管庫ではなく、端末／ブラウザプロファイルにアクセスできる人からは守れません。

## 5. 取得開始・停止、Jev明示有効化

1. `https://www.youtube.com/watch?v=...` または `/live/...` の対象視聴タブを開きます。
2. そのタブで拡張アイコンを押し、「この動画のチャットを取得」を押します。
3. 開いたmonitorページで対象動画IDを確認し、「取得を開始」を押します。YouTubeキー未設定なら先に設定します。
4. monitorを開いたままYouTubeタブを前面へ戻せます。裏のタブはブラウザによって取得が遅くなる場合があります。初回取得は直近の一部で、全履歴ではありません。
5. Jevを使うときだけ、monitorの送信範囲／費用の説明を読み、「Jev判定を有効化・再開」を押します。キー保存だけではJev送信しません。有効化後の新着を順に評価します。
6. 「Jev判定を停止」はJev送信を止めます。YouTube取得とローカル連投の判定は継続します。
7. 「取得を停止」は取得とJev判定を止めます。monitorを閉じる／離れる、動画遷移、視聴タブclose、YouTubeキー差替え／削除でも停止します。Jevキー差替え／削除はJev判定を停止します。自動再開せず、必要なら対象を選び直して明示再開します。

Jevへ送る投稿データは、対象と既取得の同一投稿者の直近60秒以内、対象込み最大20件の本文と投稿時刻だけです。message ID、author ID、videoID、他投稿者の履歴は送信stateへ入れません。APIキーはTypeSafe認証用ヘッダーに必要ですが、投稿データには入れません。本文に氏名・住所等が書かれていれば本文として送られ得ます。「IDを送らない」は匿名化の保証ではありません。追加の履歴APIは呼びません。

7項目（攻撃、差別・憎悪、脅迫、性的嫌がらせ、非公開個人情報晒し、スパム、無関係な宣伝）のどれかが `>= 0.8`、または同一投稿者の10秒以内10件以上で悪質と判定します。ネタバレは除外します。投稿時刻不明は時間条件判定不能、API失敗は悪質／安全の確定根拠にしません。これは合意ルールで、実モデルの精度保証ではありません。[Jev契約の詳細](jev-moderation.md)

## 6. 非表示一覧・明示解除・リスト削除

非表示の対象は確定したJev悪質判定または既取得投稿によるローカル連投だけです。判定待ち・失敗では登録しません。実DOMではtext-messageのみ確認済みで、paid-message等やreplayでの非表示は保証しません。[対応範囲](local-author-filter.md)

1. popupから対象のwatch/liveタブを選び、開いたmonitorの「この配信の非表示投稿者」で投稿者名の一覧を確認します。未取得名や以前のID-onlyデータは「名前不明」と表示し、「投稿者ID」を開くと補足IDを確認できます。名前では照合せず、同名でも別IDなら別投稿者です。別配信を確認・解除するにはその配信のタブをpopupから選び直します。全配信一覧はありません。
2. 対象投稿者の「非表示を解除」を押します。同名の場合は補足IDも確認してください。contentの定期更新で、まだページに存在する既存行と新着行へ反映します（非activeタブでは遅れる場合があります）。削除済みの投稿を再生成はしません。
3. リストはvideo ID別に `chrome.storage.local` の `hiddenAuthors.<video ID>` に `{ ids, revisions, displayNames? }` として保持します。`ids` は非表示channel ID、`revisions` は解除世代、`displayNames` は既取得の表示名です。名前の補完APIは使いません。同期・自動期限はありません。
4. 「取得を停止」やmonitor close、キー削除は取得／判定を止めても登録済みの既存・新着非表示とリストを解除しません。worker／browser再起動後もリストは残り、取得とJev opt-inは自動再開しません。
5. 各配信で保存済みの対象を個別に解除します。一括解除／revision完全削除UIはありません。解除で対象は `ids` から外れますが、解除前の結果の即再登録を防ぐ `revisions` metadataと空のrecordは残ります。解除後の新しい悪質投稿は再登録され得ます。worker再起動を跨ぐmessage IDの重複排除は永続化していません。

API由来IDを解除まで保持する仕様のYouTube規約適合性は未確認です。文書上だけで30日自動削除へ仕様変更したり、永久保持を許可済みと扱ったりしません。

## 7. 費用・Googleクォータ

- Jevの料金は利用者のTypeSafe契約に従います。公式トップは「$42 / Per Billion input tokens」と表示しますが、実際の請求単価・税・credit・自動補充条件はConsole／Orderを確認してください。広告の速度や料金例を本拡張の実測値として使いません。[5][20]
- 本文に加え質問／rubricと文脈も入力です。コメント数だけでは請求額を決められません。API応答のusageとConsoleを確認し、不要時はJevを停止します。拡張に利用額上限や請求額確定表示はありません。
- Googleのquota unitはJevの料金とは別です。取得時点の公式表は `videos.list` と `liveChatMessages.list` が各1 unit。無効な要求も少なくとも1、追加ページごとにも消費します。[12]
- 公式の他endpoint合算の既定割当は日次10,000 units、日次リセットはPacific Timeの深夜。上限は変更され得るため、自分のCloud Consoleの表示を優先します。上限を超えたら停止し、割当／リセットを確認します。別projectへ切替えて制限を回避しないでください。[11][12]
- 本作業ではGoogle APIの実料金・請求・クォータ消費は測定していません。quota単位を金額と同一視せず、他Cloudサービスの請求まで無料と保証しません。

## 8. 各キー削除・提供元失効・アンインストール

### 拡張に保存したキーだけを削除

設定画面で「Jevキーを削除」「YouTubeキーを削除」をそれぞれ押し、そのproviderが「未設定」になったことを確認します。一方を削除しても他方は削除しません。Jevだけ削除してもYouTube取得は別です。

### 提供元のキーも失効させる

拡張内の削除は提供元アカウントのキー失効ではありません。漏洩が疑われるときは、Google Cloud Consoleの認証情報で当該キーを削除／ローテーションし、TypeSafe Consoleのキー管理でも取消を確認します。Google公式は新キーへの置換後に旧キーを削除するローテーションを説明しています。TypeSafeログイン後UIの取消ボタン名は未確認で、必要なら公式supportへ問い合わせます。[13][20]

### リスト／全ローカルデータを削除

リストの非表示IDは前節の個別「非表示を解除」で除外できますが、`revisions` metadataは残ります。リストの解除でキーを削除しません。キー削除でリストを削除しません。全localデータの消去には拡張の削除が必要です。ブラウザの閲覧履歴／キャッシュ削除は拡張storageの削除方法ではありません。[19]

全ローカルデータを捨てる場合は取得を停止してmonitorを閉じ、`chrome://extensions` でAgent Moderatorを「削除」します。Chrome公式は拡張を削除すると `storage.local` が消去されると説明しています。再インストール後のキー／リスト復元は保証しません。[19]

アンインストールしてもGoogle／TypeSafeアカウント、提供元キー、すでに送信したデータ、課金契約・自動補充、既存請求は消えません。提供元に送ったデータの削除は提供元で別途依頼してください。YouTube上の投稿をこの拡張から削除する機能はありません。

## 9. トラブル対処

| 状態 | 対処 |
| --- | --- |
| Chromeに読み込めない | 選んだフォルダー直下にmanifest.jsonがあるか、ビルドが成功したかを確認。エラー共有時にキーやキー付きURLを含めない |
| 設定済みなのに認証失敗 | 保存と認証は別。provider、API有効化、キー失効、アプリケーション／API制限を確認。空欄保存では削除できない |
| 取得を開始できない | YouTubeキー、視聴動画URL、popupで選んだ対象を確認。開始前・終了・チャット無効・非公開／取得不能を区別する |
| quota／429／混雑 | 自動retryしない。Cloud割当／TypeSafe残高と、表示された待機時間を確認し、期限後に明示再開。連打やproject切替で回避しない |
| network／不正応答 | 通信が止まっていることを確認。障害解消後に明示再開。失敗を悪質判定へ読み替えない |
| Jev未判定 | 明示有効化前の投稿、履歴窓外、時刻不明、停止／障害を区別。失われた本文の追加取得はしない |
| 表示が遅い | monitorを閉じていないか確認。裏タブのthrottling、判定の直列処理は速度保証なし |
| 動画を移動した | 新動画の視聴タブでpopupから選び直して開始。旧動画の取得は続けない |
| 再起動後 | 自動取得／Jev opt-inを期待せず明示開始。非表示リストは保持される（隔離Chromium fixtureで再起動を確認） |
| 停止したのに見えない | 停止は解除ではない。monitorの「この配信の非表示投稿者」で対象IDを「非表示を解除」する |
| 実YouTubeで非表示にならない | DOM変更・投稿者IDの照合不能を疑うが、名前一致で非表示しない。実DOMで確認したのはtext-messageのlocal seedによる表示・復元のみ。実API登録や他rendererを保証しない |

問い合わせにはOS、Chrome／拡張版、実施手順、秘密を除いた固定エラー、再現可否を記録してください。DevTools Networkには認証ヘッダー／キー付きURL／他人の本文が含まれ得ます。実キー入りのprofileや生通信ログを提出しないでください。

## Sources

[5] https://typesafe.ai
[6] https://docs.typesafe.ai/api
[7] https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world
[11] https://developers.google.com/youtube/v3/getting-started
[12] https://developers.google.com/youtube/v3/determine_quota_cost
[13] https://cloud.google.com/docs/authentication/api-keys
[14] https://cloud.google.com/api-keys/docs/add-restrictions-api-keys
[15] https://docs.typesafe.ai/introduction/quickstart
[16] https://docs.typesafe.ai/introduction/quickstart.md
[19] https://developer.chrome.com/docs/extensions/reference/api/storage
[20] https://typesafe.ai/legal/mca
