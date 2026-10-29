# 北海道運行情報（試験版）

札幌・新千歳空港・小樽まわりの鉄道・地下鉄・空港・バス・高速道路・フェリーの運行情報を、1ページにまとめた非公式ページです。飛行機が止まったときにフェリーで本州へ渡る経路の案内つき。

公開URL:<https://realryo1.github.io/hokkaido_delay/>（試験版。検索結果には出しません）

姉妹プロジェクト:[SNOWMIKU2027非公式カレンダー](https://github.com/realryo1/sm27calendar)（<https://realryo1.github.io/sm27calendar/>）。もとはカレンダーの試験ページとして作っていたもので、2026-10-27に別リポジトリに分けました。デザイン（配色・フォント・背景）はカレンダーとそろえています。

> 本ページは非公式です。各社の公開情報を自動で集めて表示しており、内容の正確さ・最新であることは保証しません。お出かけの前には、必ず各社の公式情報を確認してください。このページについて、交通事業者へのお問い合わせはしないでください。

## 特長

- JR北海道・札幌市営地下鉄・新千歳空港（国内線）・札幌丘珠空港・道央道/札樽道・北海道中央バス・北都交通・フェリー4社の状態を一覧
- 行き先ごと（札幌⇄新千歳空港・札幌⇄小樽・札幌市内・北海道⇄本州）のまとめ
- 「もし飛行機が止まったら？」：札幌・新千歳・小樽からフェリーに乗るまでの行き方と直近の便
- 1分ごとに自動更新、情報の更新が止まったときや取得できないときは公式リンクを表示

## 構成

ページはビルド不要の静的サイト（HTML/CSS/JavaScriptのみ）、データはCloudflareWorkerが集めて配信します。

|パス|内容|
|---|---|
|`website/index.html`|ページ本体（title/descriptionはここに静的に記述）|
|`website/delay.js`|運行情報の取得と描画|
|`website/plan.js`|「もし飛行機が止まったら？」の時刻表と計算|
|`website/base.css`|配色・フォント・背景・フッター（カレンダーの`style.css`から写したもの）|
|`website/delay.css`|このページの部品|
|`website/favicon.svg`|ファビコン（カレンダーと同じ配色）|
|`website/sample.json`|サンプル表示（`?sample`）のデータ|
|`worker/`|運行情報を5分ごとに集めて配信するCloudflareWorker（[worker/README.md](worker/README.md)）|
|`document/`|調査資料（`tienResearch.md`）と実装・進捗のまとめ（`delayProgress.md`）|
|`tools/`|デプロイスクリプト（`deploy-pages.mjs`）|

## 運行情報の取得

- 事業者サイトへはWorkerのCron（5分ごと）だけがアクセスし、ページはWorker（`https://delay.realryo1.com/status.json`）から取得します。
- 事業者の文章は取り込まず、状態・便名・時刻などの事実だけを扱います。企業ロゴは使いません（色のみ使用）。
- 詳細は[document/delayProgress.md](document/delayProgress.md)。

## デザイン

- カレンダーと見た目をそろえるため、`base.css`の値はカレンダーの`website/style.css`と同じにしています。配色を変えるときは両方を直します。
- 配色はSNOWMIKU2027公式サイトのパレットに準拠しています（カレンダーと同じ）。
- スマホ表示の切り替えは、カレンダーと同じ640px以下です。
- ServiceWorkerは使いません（運行情報は古いものを出すと危険なため、キャッシュしません）。

## ローカルで確認

`website/`を静的サーバーで配信。VSCode拡張のLiveServerなどを使用してください。`?sample`でサンプル表示、`?embed=1`でカレンダーのサイドバーに埋め込むときの表示（カレンダーへ戻るリンクを隠す）。Workerを手元で動かす方法は[worker/README.md](worker/README.md)。

## デプロイ

- ページ：Actionsで手動実行するか、VSCodeでこのフォルダを開いてF5（「Deploy:push→GitHubPages」）を実行すると、`main`をpushしてGitHubActionsの[deploy-pages.yml](.github/workflows/deploy-pages.yml)を起動し、`website/`がGitHubPagesに公開されます。未コミットの変更があると中断します。F5の場合は、公開URLの`index.html`が新しくなる（CDNに反映される）まで待ってから完了と表示します。
- カレンダーと一括：sm27calendarのフォルダを開いてF5で「Deploy:一括（カレンダー＋運行情報）」を選ぶと、両方のデプロイを同時に実行します（手元では`hokkaido_delay/`をsm27calendarの中に置いているため）。
- Worker：CloudflareのGitHub連携（WorkersBuilds）で、`main`にpushすると`worker/`が自動でデプロイされます。

## 注意

- 本プロジェクトは交通事業者・SNOWMIKU公式とは無関係です。
- 運行情報の取得について、権利者からの停止の要望があった際には即時停止いたします。

## 問い合わせ

[@realryo1](https://x.com/realryo1) のDM、リプライ

realryo1 アットマーク ジーメール ドット コム（検索避けです）
