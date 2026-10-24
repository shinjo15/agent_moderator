# Agent Moderator

YouTube Live向けの独立チャットビューアーです。利用者自身のAPIキーで公式APIからチャットを取得し、任意のJev評価と配信別の投稿者リスト保存・一覧確認・解除を行います。保存対象のコメントは拡張の独立画面だけで非表示にし、YouTube本体の表示・操作は変更しません。BAN・投稿・削除は対象外です。

導入・APIキー設定・費用・操作・判定JSONの変更手順は [日本語導入手順](docs/onboarding.md) を参照してください。データの送信・保持・削除は [プライバシーポリシー（案）](docs/privacy.md)、利用条件は [利用規約（案）](docs/terms.md) に記載しています。両案は施行日未定で、正式施行・一般配布・提供元の承認を意味しません。

実YouTube Data API・実Jevへの接続、実モデルの精度・速度・prompt injection耐性は未検証です。自動テストのAPI fixtureは実モデルの予測・精度測定ではありません。YouTube APIの利用条件への適合・公開配布の承認は別途確認が必要です。

## 開発・検証

Node.js 24 LTS以上とnpmを使用します。

```sh
npm ci
npx playwright install --with-deps chromium
npm run test
npm run typecheck
npm run build
npm run test:e2e
npm run check
npm run package
```

Chromeへの読み込みは導入手順を参照してください。旧版から更新する場合は、拡張と、視聴・popout・リプレイを含むYouTubeの全タブを再読み込みするか閉じて開き直してください。旧スクリプトや非表示スタイルが拡張更新だけで消えるとは限りません。保存リストを消す必要はありません。

実APIキーやキー付きURLをソース・ログ・Issue・配布物に含めないでください。