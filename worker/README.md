# 北海道運行情報Worker

`website/`のページに表示する運行情報を集めるCloudflare Workerです。設計の元は`document/tienResearch.md`、実装と進捗のまとめは`document/delayProgress.md`。

- Cron（5分ごと、毎時:02, :07,…。新千歳空港FISの更新:01, :06,…の直後）で各事業者から取得し、Workers KVに1本のJSON（キー`status`）として保存
- `GET /status.json`でKVのJSONを返す（isolateのメモリに60秒持つ。workers.devではCache APIが効かないため）。読めるのはOrigin（なければReferer）が`https://realryo1.github.io`かlocalhostのときだけで、それ以外は403。`wrangler dev`（localhost:8787）では制限しない
- 作者の確認用に、環境変数`ALLOW_IPS`（カンマ区切りのIP。ダッシュボードのWorker → Settings → Variables and Secretsで設定し、リポジトリには書かない）のIPからは、Origin・Refererがなくても`/status.json`を返す（ブラウザでURLを直接開いてJSONを見られる）
- `/status.json`は日本国内のネットワーク（`request.cf.country`がJP）にだけ返す。国外なら`{"error":"region"}`の403で、ページが位置情報の許可を求め、約10km単位に丸めた現在地を`?lat=&lon=`で付けて取り直す（国内の範囲は`src/index.js`の`JAPAN`）
- IPごとに10秒60回までのレート制限（ダッシュボードのSecurity rulesにあるWAFのRate Limitingルール。超えたら10秒ブロック）。携帯回線などで大勢がIPを共有するのでゆるめ。workers.devは止めているので、必ずWAFを通る
- 閲覧者が増えても、事業者サイトへのアクセスは5分に1回のまま

- `GET /health`は外部の監視サービス向け。異常なら503（KVを読むだけで、事業者へは取りに行かない）

公開先：`https://delay.realryo1.com/status.json`

## ファイル

| パス | 内容 |
| --- | --- |
| `src/index.js` | Cron（収集してKVに保存、`next_update_at`を付ける）、`/status.json`の配信、`/health` |
| `src/collect.js` | 全事業者を並行して取得し、1本のJSONにまとめる。失敗した事業者は前回のデータを残す |
| `src/sources/jr.js` | JR北海道（`webunkou/json/area/area_01.json`） |
| `src/sources/subway.js` | 札幌市営地下鉄（`operationstatus.city.sapporo.jp/unkojoho/top.html`） |
| `src/sources/airport.js` | 新千歳空港国内線（`hokkaido-airports.com/api/v1/new-chitose/static/fis/domestic/today.json`） |
| `src/sources/okadama.js` | 札幌丘珠空港（`okadama-airport.co.jp/flight/`の出発・到着の表） |
| `src/sources/expressway.js` | 高速道路道央道・札樽道（アイハイウェイ`ihighway.jp/datas/json/traffic.json`） |
| `src/sources/chuobus.js` | 北海道中央バス空港連絡バス・高速おたる号・高速とまこまい号（運休情報のRSS`chuo-bus.co.jp/support/stop/?ope=feed&topic=stop_list`） |
| `src/sources/hokto.js` | 北都交通空港連絡バス（`hokto.co.jp`のトップ） |
| `src/sources/silverferry.js` | シルバーフェリー（`silverferry.jp`のトップ。欠航・遅延のときはリンク先のお知らせから便ごとの状況も） |
| `src/sources/sunflower.js` | さんふらわあ大洗〜苫小牧（`sunflower.co.jp`のトップ。平常時以外は欄の中の便ごとの状況も） |
| `src/sources/snf.js` | 新日本海フェリー（`snf.jp`のトップのヘッダーと、お知らせがあるときはお知らせの本文） |
| `src/notes.js` | フェリー3社（新日本海フェリー・シルバーフェリー・さんふらわあ）のお知らせの要約・補足・正規表現で読まない便をClaude Haiku 5.5で読み、便に重ねる（平常時は呼ばず、本文が変わったときだけ呼ぶ） |
| `src/noticeTexts.js` | 上に渡すお知らせの本文の置き場所（JSONには入れない） |
| `scripts/llm-local.mjs` | 保存したお知らせのHTMLで、上のLLMの処理を手元で試す（`worker/.env`の`ANT_API_TOKEN`を使う。1件0.1〜0.2円ほどかかる）。`node scripts/llm-local.mjs snf 2026-01-09 a.html silverferry b.html sunflower c.html` |
| `src/sources/taiheiyo.js` | 太平洋フェリー名古屋・仙台〜苫小牧（`taiheiyo-ferry.co.jp`のトップの「運航状況」欄） |
| `src/http.js` | 取得の共通設定（User-Agent、8秒のタイムアウト、`Last-Modified`の読み取り）と日本時間の時刻 |
| `scripts/collect-local.mjs` | Cloudflareを使わずに収集だけ1回動かす |
| `wrangler.toml` | Worker名・Cron・KV・ログの設定 |
| `.env` | 手元の試験用のAPIキー（`ANT_API_TOKEN`）。Gitには入れない。wranglerもこのファイルを読む |

対応していない交通機関（市電）は、ページに公式リンクだけ出している。

## 変更するときの注意

- Cronの間隔を変えるときは、`src/index.js`の`INTERVAL_MIN`も合わせる（`next_update_at`の計算に使う）
- 空港の時刻はFISの更新（:01, :06,…）の直後に取るため、Cronは:02, :07,…にしている
- 事業者の文章（遅れの理由などの長文）はページに出さず、状態・便名・時刻などの事実だけをJSONに入れる。読むために取り込むのはよい。LLMがまとめた内容は事実なので出してよい
- User-Agentにはプロジェクト名とサイトのURLを入れている（`src/http.js`）。ブラウザを装わない
- 手元の確認で事業者サイトへ取りに行くときは、連続で実行しないこと

## デプロイ

CloudflareのGitHub連携（Workers Builds）で、`main`にpushすると自動でデプロイされる。

- リポジトリ：`realryo1/hokkaido_delay`（2026-10-27までは`realryo1/sm27calendar`）
- Project name：`sm27-delay`（Worker名。カスタムドメインとKVが付いているので、リポジトリを分けたときも変えていない）/Root directory：`worker`/Build command：空欄/Deploy command：`npx wrangler deploy`
- Build watch paths：`worker/*`（`website/`だけの変更ではデプロイしない）
- KV（`DELAY_KV`）はダッシュボードで作成し、IDを`wrangler.toml`に入れてある
- Claude APIのキーは、ダッシュボードのWorker → Settings → Variables and Secretsにシークレット`ANT_API_TOKEN`として置く（手元では`worker/.env`。Gitには入れない）。ないときはLLMを呼ばず、正規表現で読んだ便だけになる
- 依存（`wrangler`・`@anthropic-ai/sdk`）は`package-lock.json`のとおりにWorkers Buildsが入れる
- Cronの追加・変更は、反映まで最大15分かかる
- ログはダッシュボードのWorker → Observabilityで見る（`wrangler.toml`の`[observability]`）

## 手元で収集だけ試す（Cloudflare不要）

```sh
node worker/scripts/collect-local.mjs            # 標準出力へ
node worker/scripts/collect-local.mjs out.json   # ファイルへ
```

ページで見るときは`node worker/scripts/collect-local.mjs website/_local.json`で書き出し、Live Serverなどで`website/?api=_local.json`を開く（`_local.json`は`.gitignore`済み）。

## 手元でWorkerごと動かす

`cd worker` → `npm install` → `npm run dev`（KVは手元の仮のものが使われる）  
別のターミナルで`curl "http://localhost:8787/__scheduled?cron=2-59/5+*+*+*+*"`を叩くと収集が1回動き、`http://localhost:8787/status.json`で結果を見られる。  
ページ側はLive Serverなどで`website/?api=http://localhost:8787/status.json`を開く（`?api=`はlocalhostで開いたときだけ有効）。

## 監視（/health）

`https://delay.realryo1.com/health`をWorkerの外から定期的に見る（今はGrok BotのRoutineに頼んでいる）。`ok`がfalseなら`problems`を確認する。

| 結果 | 条件 |
| --- | --- |
| 503 | `updated_at`が17分以上古い（Cronが3回動いていない）／同じ事業者で3回続けて失敗／`source_warnings`がある／KVにデータがない／フェリーのLLMが同じお知らせで3回続けて失敗（前払いの残高切れを含む）か、APIキー（`ANT_API_TOKEN`）がない／LLM処理の予期せぬ例外（`id: "llm"`） |
| 200 | それ以外。1〜2回だけの失敗は`notes`に載る |

```jsonc
{ "ok": false, "updated_at": "…", "problems": ["jr: HTTP 503 …（3回連続）"], "notes": [] }
```

## 無料枠の目安

- Workersリクエスト：1日10万回
- KV書き込み：1日1,000回（5分ごとで1日288回）
- KV読み取り：1日10万回（isolateのメモリに60秒持つので実際はもっと少ない。`/health`も同じ）
- WAFでブロックしたリクエストはWorkersのリクエスト数に入らない。Workerの中で403にしたもの（Origin・国外）は入る
- Claude API（無料枠ではなく前払い）：Haiku 5.5で1件約$0.001（入力2,500〜3,900・出力500〜2,500トークン）。フェリー3社とも、平常時は呼ばず、お知らせの本文が変わったときだけ呼ぶ

## 障害時の動き

- 事業者ごとに取得し、失敗した事業者は前回のデータを残したまま`ok: false`にして`meta.source_errors`に記録する。ページでは、その事業者の状態を前回のものではなく「情報途絶」にし、見出しの横に最終取得の時刻を出す（見出しが公式へのリンク）
- 連続で失敗した回数は各事業者の`fail_count`に入る（成功で0に戻る）
- 一部だけ読めない（構造変更の疑い）ときは`meta.source_warnings`に入る。まったく読めないときは失敗扱い
- Workerに一度もつながらないときは、ページに各社の公式リンクが出る
- `updated_at`が20分以上古いと、ページに「情報の更新が止まっています」と出る
- フェリーのLLMが失敗したとき（前払いの残高切れを含む）は、そのお知らせの`llm`（シルバーフェリー・さんふらわあはサービスの`llm`）に`ok: false`と`error`が入り、ページは正規表現で読んだ便だけになる。同じ本文では3回まで続けて試し、そのあとは1時間に1回呼び直す（残高を足せば戻る）。`/health`には`snf: LLM: …`（`silverferry`・`sunflower`）として出る（上の表）。キーがないときは、置いた次の回に呼ぶ
- JR北海道と札幌市の配信元はImperva（ボット対策）の配下。今はCloudflareから取得できているが、弾かれるようになったら`source_errors`に出る
