# 北海道運行情報 Worker（試験版）

`website/` のページに表示する運行情報を集める Cloudflare Worker です。設計の元は `document/tienResearch.md`、実装と進捗のまとめは `document/delayProgress.md`。

- Cron（5分ごと、毎時 :02, :07, …。新千歳空港 FIS の更新 :01, :06, … の直後）で各事業者から取得し、Workers KV に1本の JSON（キー `status`）として保存
- `GET /status.json` で KV の JSON を返す（isolate のメモリに60秒持つ。workers.dev では Cache API が効かないため）。読めるのは Origin（なければ Referer）が `https://realryo1.github.io` か localhost のときだけで、それ以外は 403。`wrangler dev`（localhost:8787）では制限しない
- `/status.json` は日本国内のネットワーク（`request.cf.country` が JP）にだけ返す。国外なら `{"error":"region"}` の 403 で、ページが位置情報の許可を求め、約10km単位に丸めた現在地を `?lat=&lon=` で付けて取り直す（国内の範囲は `src/index.js` の `JAPAN`）
- IP ごとに10秒60回までのレート制限（ダッシュボードの Security rules にある WAF の Rate Limiting ルール。超えたら10秒ブロック）。携帯回線などで大勢が IP を共有するのでゆるめ。workers.dev は止めているので、必ず WAF を通る
- 閲覧者が増えても、事業者サイトへのアクセスは5分に1回のまま

- `GET /health` は外部の監視サービス向け。異常なら 503（KV を読むだけで、事業者へは取りに行かない）

公開先：`https://delay.realryo1.com/status.json`

## ファイル

| パス | 内容 |
| --- | --- |
| `src/index.js` | Cron（収集して KV に保存、`next_update_at` を付ける）、`/status.json` の配信、`/health` |
| `src/collect.js` | 全事業者を並行して取得し、1本の JSON にまとめる。失敗した事業者は前回のデータを残す |
| `src/sources/jr.js` | JR北海道（`webunkou/json/area/area_01.json`） |
| `src/sources/subway.js` | 札幌市営地下鉄（`operationstatus.city.sapporo.jp/unkojoho/top.html`） |
| `src/sources/airport.js` | 新千歳空港 国内線（`hokkaido-airports.com/api/v1/new-chitose/static/fis/domestic/today.json`） |
| `src/sources/okadama.js` | 札幌丘珠空港（`okadama-airport.co.jp/flight/` の出発・到着の表） |
| `src/sources/expressway.js` | 高速道路 道央道・札樽道（アイハイウェイ `ihighway.jp/datas/json/traffic.json`） |
| `src/sources/chuobus.js` | 北海道中央バス 空港連絡バス・高速おたる号・高速とまこまい号（運休情報の RSS `chuo-bus.co.jp/support/stop/?ope=feed&topic=stop_list`） |
| `src/sources/hokto.js` | 北都交通 空港連絡バス（`hokto.co.jp` のトップ） |
| `src/sources/silverferry.js` | シルバーフェリー（`silverferry.jp` のトップ。欠航・遅延のときはリンク先のお知らせから便ごとの状況も） |
| `src/sources/sunflower.js` | さんふらわあ 大洗〜苫小牧（`sunflower.co.jp` のトップ） |
| `src/sources/snf.js` | 新日本海フェリー（`snf.jp` のトップのヘッダー） |
| `src/sources/taiheiyo.js` | 太平洋フェリー 名古屋・仙台〜苫小牧（`taiheiyo-ferry.co.jp` のトップの「運航状況」欄） |
| `src/http.js` | 取得の共通設定（User-Agent、8秒のタイムアウト、`Last-Modified` の読み取り）と日本時間の時刻 |
| `scripts/collect-local.mjs` | Cloudflare を使わずに収集だけ1回動かす |
| `wrangler.toml` | Worker 名・Cron・KV・ログの設定 |

対応していない交通機関（市電）は、ページに公式リンクだけ出している。

## 変更するときの注意

- Cron の間隔を変えるときは、`src/index.js` の `INTERVAL_MIN` も合わせる（`next_update_at` の計算に使う）
- 空港の時刻は FIS の更新（:01, :06, …）の直後に取るため、Cron は :02, :07, … にしている
- 事業者の文章（遅れの理由などの長文）は取り込まず、状態・便名・時刻などの事実だけを扱う
- User-Agent にはプロジェクト名とサイトの URL を入れている（`src/http.js`）。ブラウザを装わない
- 手元の確認で事業者サイトへ取りに行くときは、連続で実行しないこと

## デプロイ

Cloudflare の GitHub 連携（Workers Builds）で、`main` に push すると自動でデプロイされる。

- リポジトリ：`realryo1/hokkaido_delay`（2026-10-27 までは `realryo1/sm27calendar`）
- Project name：`sm27-delay`（Worker 名。カスタムドメインと KV が付いているので、リポジトリを分けたときも変えていない） / Root directory：`worker` / Build command：空欄 / Deploy command：`npx wrangler deploy`
- Build watch paths：`worker/*`（`website/` だけの変更ではデプロイしない）
- KV（`DELAY_KV`）はダッシュボードで作成し、ID を `wrangler.toml` に入れてある
- Cron の追加・変更は、反映まで最大15分かかる
- ログはダッシュボードの Worker → Observability で見る（`wrangler.toml` の `[observability]`）

## 手元で収集だけ試す（Cloudflare 不要）

```sh
node worker/scripts/collect-local.mjs            # 標準出力へ
node worker/scripts/collect-local.mjs out.json   # ファイルへ
```

ページで見るときは `node worker/scripts/collect-local.mjs website/_local.json` で書き出し、Live Server などで `website/?api=_local.json` を開く（`_local.json` は `.gitignore` 済み）。

## 手元で Worker ごと動かす

`cd worker` → `npm install` → `npm run dev`（KV は手元の仮のものが使われる）  
別のターミナルで `curl "http://localhost:8787/__scheduled?cron=2-59/5+*+*+*+*"` を叩くと収集が1回動き、`http://localhost:8787/status.json` で結果を見られる。  
ページ側は Live Server などで `website/?api=http://localhost:8787/status.json` を開く（`?api=` は localhost で開いたときだけ有効）。

## 監視（/health）

`https://delay.realryo1.com/health` を Worker の外から定期的に見る（今は Grok Bot の Routine に頼んでいる）。`ok` が false なら `problems` を確認する。

| 結果 | 条件 |
| --- | --- |
| 503 | `updated_at` が17分以上古い（Cron が3回動いていない）／同じ事業者で3回続けて失敗／`source_warnings` がある／KV にデータがない |
| 200 | それ以外。1〜2回だけの失敗は `notes` に載る |

```jsonc
{ "ok": false, "updated_at": "…", "problems": ["jr: HTTP 503 …（3回連続）"], "notes": [] }
```

## 無料枠の目安

- Workers リクエスト：1日10万回
- KV 書き込み：1日1,000回（5分ごとで1日288回）
- KV 読み取り：1日10万回（isolate のメモリに60秒持つので実際はもっと少ない。`/health` も同じ）
- WAF でブロックしたリクエストは Workers のリクエスト数に入らない。Worker の中で 403 にしたもの（Origin・国外）は入る

## 障害時の動き

- 事業者ごとに取得し、失敗した事業者は前回のデータを残したまま `ok: false` にして `meta.source_errors` に記録する。ページにはその事業者の公式リンクが出る
- 連続で失敗した回数は各事業者の `fail_count` に入る（成功で0に戻る）
- 一部だけ読めない（構造変更の疑い）ときは `meta.source_warnings` に入る。まったく読めないときは失敗扱い
- Worker に一度もつながらないときは、ページに各社の公式リンクが出る
- `updated_at` が20分以上古いと、ページに「情報の更新が止まっています」と出る
- JR北海道と札幌市の配信元は Imperva（ボット対策）の配下。今は Cloudflare から取得できているが、弾かれるようになったら `source_errors` に出る
