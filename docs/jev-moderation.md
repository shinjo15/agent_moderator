# Issue #4: Jevによるライブコメント評価

## 範囲と責務

Issue #3の公式YouTube取得を基盤に、取得したコメントの評価とmonitor表示だけを追加する。DOM非表示、BAN、投稿・削除、Issue #5は実装しない。キー管理の保存契約は変更しない。実キーは参照せず、synthetic/API fixtureだけで検証した。

- `src/jev/client.ts`: background専用の固定endpoint HTTP client、timeout、HTTP分類、全項目の応答validation。
- `src/jev/policy.ts`: 固定rubricとnoul評価値から悪質性を決める純粋policy。
- `src/jev/history.ts`: 既取得コメントの重複防止、必要な本文文脈と連投の時刻根拠を分離して管理。
- `src/jev/moderation.ts`: opt-in、取得済みIDとの対応付け、直列通信、キー再確認、停止・世代・Retry-After調整。
- `src/youtube/background-handler.ts`: #3の同一拡張ID・exact monitor URL・monitor tab binding・対象動画照合をJev要求にも適用。成功した実list結果だけを履歴へ渡す。
- `src/jev/runtime-transport.ts`: IDだけのIPC、対応先と評価値・判定結果の整合性検証、固定エラーへの変換。
- `src/jev/monitor.ts` / `src/monitor.ts`: 明示有効化・停止、送信範囲と費用説明、評価値・理由・未判定/失敗表示。本文はtextContentで表示する。

不要な単一メソッドPortや追加の履歴APIは設けない。

## 公式API契約

一次資料を読んで実装した:

- https://docs.typesafe.ai/api
- https://docs.typesafe.ai/primitives/noul

`POST https://api.typesafe.ai/v1/systemone`、`Authorization: Bearer <利用者のJevキー>`、JSONの`model: jev-latest`、`state`、`questions`を使用する。キーと通信はbackgroundのみ。credentials omit / cache no-store / redirect errorで送信し、一回要求を20秒で中断する。これは通信timeoutであり、追加の業務しきい値や日次利用上限ではない。

7項目を1 callのquestions mapへまとめ、それぞれ`type: noul`、固定instructions、true/false criteriaを指定する。noulは0〜1のyes評価値であり、別のconfidenceではない。score primitiveやconfidenceを悪質性の評価値として代用しない。

応答は非空model、全7項目のanswers（余分な項目も拒否）、各answer.type=noul、有限な0〜1のnoul、非負の安全整数usage.input_tokens/output_tokensを検証する。一項目でも不正なら全体を失敗として扱う。戻り値は評価値・model・usageの明示したフィールドだけで、providerの追加フィールドやエラー本文は透過しない。

## 承認済みの業務ルール

| 項目code | 対象 |
| --- | --- |
| attack | 人への攻撃・侮辱・人格否定 |
| hate | 属性に基づく差別・憎悪 |
| threat | 脅迫・危害の扇動 |
| sexualHarassment | 相手への性的嫌がらせ |
| doxxing | 他人の非公開個人情報晒し |
| spam | 迷惑な反復・大量投稿等のスパム |
| unrelatedPromotion | 配信に無関係な宣伝 |

いずれかのraw noul評価値が `>= 評価開始時の設定threshold` なら悪質。初期値は中0.8、高0.65／低0.9を選べ、詳細設定で0〜1 inclusiveの有限数値を保存できる。0は全評価済みコメントが該当し、1は評価値1だけが該当する。これはアプリ側のdecisionでありJev要求のrubricは変更しない。設定の保存・適用時点は [filter-settings.md](filter-settings.md) を参照。ネタバレは対象外。単なる批判・否定的感想、引用報告・注意喚起、非攻撃的冗談、ゲーム内表現はそれだけでは悪質としない。文脈不明では該当すると断定しないrubricを固定questionsへ入れる。

評価対象はtarget本文だけ。historyは参照文脈であり、過去の攻撃だけで現在の批判や引用を悪質に転嫁しない。投稿内の命令・役割指定・評価値指定は未信頼stateとして扱い、固定questionsに従う構成にする。ただし、この入力分離は実モデルのprompt injection耐性を実証・保証したものではない。

ローカル連投は同じ動画・監視session・投稿者の、対象を含む10秒以内10件以上の異なるmessage IDで確定する。10秒ちょうど・10件ちょうどを含む。受信時刻ではなく既存list応答のsnippet.publishedAtを使う。Jev通信の成功・失敗・未有効化から独立した正の根拠としてburstを返す。連投確定した対象はJevに送らず、そのローカル根拠だけで悪質を返せる。

## 最小state・保持scope

送信stateは `{ target: { text, publishedAt? }, history: [{ text, publishedAt }] }`。同一投稿者の、対象投稿時刻以前かつ差が60秒以内の保持中の本文を最大19件選び、targetと合計最大20件にする。targetをhistoryへ重ねて送らない。ID、authorChannelId、他投稿者の履歴、キーをstateへ入れない。IDはbackgroundのローカル対応付けにだけ使う。

ChatMessageに任意のpublishedAtを追加した。従来の投稿時刻なしfixturesを引き続き受け付け、受信時刻や現在時刻で補完しない。RFC3339の実在日時・offset・最大9桁の小数秒を検証し、時間条件は内部のnanosecond整数で比較する。IPCへは元の時刻文字列だけを渡す。

保持はworkerのメモリ内、動画/monitor bindingのsession単位:

- 本文は投稿時刻の最新watermarkから60秒窓内、投稿者ごと最大20件。古い本文や20件超は解放する。全配信の本文Mapを保持・走査しない。
- 連投の時刻だけの根拠を本文と分離して60秒窓内で保持する。本文を20件へ絞っても、順不同の対象の10秒10件判定を壊さない。
- 重複防止のID、投稿者との対応付け、本文なしの結果はsession内だけで保持する。local/session storageへ本文・履歴・ID cacheを永続化しない。
- 時刻不明投稿はhistory文脈へ入れず、そのtargetの時間条件をunavailableとする。本文は同一投稿者の直前の時刻不明targetを置き換え、次の有効時刻投稿による整理、取得停止、session変更で解放する。後続の有効時刻投稿へunavailableを永続的に伝播させない。
- 保持窓より古い順不同targetは時間条件unavailable。評価要求時に対象本文が保持されていなければJev未判定とし、失われた本文・履歴を捏造・復元・追加API再取得しない。
- Jev通信失敗・Jevキー変更・Jev判定だけの停止は外部通信の許可と世代を失効させるが、継続するYouTube取得のローカル連投根拠は消さない。
- 取得停止・ページ再読込では本文文脈と時刻根拠を解放し、同じbindingの重複IDは再送しない。動画/monitor binding変更・closeでは対応付けも含め全sessionを解放する。
- worker再起動では履歴とopt-inが失われる。自動復元・自動有効化はしない。

## IPCと停止規則

許可する要求はexact authorized monitorからの次の形だけ:

- `{ type: 'jev.enable' }`: キー設定とcooldownを確認し明示有効化。
- `{ type: 'jev.disable' }`: Jevだけ停止。ローカル連投の収集は継続。
- `{ type: 'jev.stopCollection' }`: Jev停止と本文/時刻文脈解放。
- `{ type: 'jev.evaluate', id: <実取得message ID> }`: backgroundが取得済みの対象だけを評価。本文・キー等の余分なpayloadは拒否。

成功した評価応答は元のYouTube message ID、authorChannelId、burst状態、悪質性と理由code、Jev状態、任意の評価値/model/usageまたは固定エラーcode。`jev: evaluated` の場合は有限0〜1の評価時 `threshold` が必須で、monitor/runtimeは現在の設定でなくその値でraw値とdecisionの整合性を検証する。本文やキーは評価応答へ含めない。失敗・未判定のmaliciousは未定義であり、「悪質=false」と誤って確定しない。連投確定なら独立したmalicious=trueとburst理由を返す。

背景側とmonitor側の両方で直列化する。重複IDは再通信しない。開始直前と応答後にキーを再読取し、await後に世代・Abort・キー一致を確認する。停止・キー変更・新binding後の遅延結果を返さない。新binding書込完了時にも世代を切り替え、途中の古い有効化を新対象へ持ち越さない。

missingキー、401、422、429、529、network、invalidResponseは悪質根拠ではない。Jevエラーでは外部通信を停止し、自動retryしない。429/529のRetry-Afterは秒数/HTTP-dateを解釈し、明示再開も期限前は拒否する。期限だけをtrusted chrome.storage.sessionへ保持し、worker再作成・動画再選択で短縮しない。日次上限は追加しない。

## 検証と限界

日本語の攻撃・差別・脅迫・性的嫌がらせ・晒し・広告spam・批判・引用・冗談・ゲーム表現・ネタバレ・命令注入のAPI fixtureは `tests/fixtures/jev.ts` にある。値は人が割り当てたfixtureであり、実モデルの予測・精度測定ではない。

production distを実ChromiumのMV3へ読み込み、YouTube fixture→monitor→background→Jev fixture→評価表示を検証した。別のUI race E2Eはproduction monitorのIPC応答/通知だけを制御し、実API経路とは区別する。詳細なRED/GREENと最終全回帰は [verification/issue-4.md](verification/issue-4.md) を参照。

実Jev/YouTube APIの認証、モデル速度・精度、課金・クォータ、prompt injection耐性、実長時間のworker終了/throttling、通常Windows ChromeとOSツールバーの手動操作は未検証。宣伝上の速度・精度を実測値として記載しない。
