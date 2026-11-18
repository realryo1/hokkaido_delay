// 北海道運行情報 Worker
// - scheduled：Cron（5分ごと）で各事業者から取得し、KV に1本の JSON として保存する
// - fetch：KV の JSON を CORS ヘッダー付きで返す（閲覧が増えても事業者へのアクセスは Cron の回数のまま）
// - /health：外部の監視サービス向け。異常があれば 503 を返す（KV を読むだけで、事業者へは取りに行かない）
import { collect, jstIso } from "./collect.js";
import { addNotes, llmResults, MAX_FAILS as LLM_MAX_FAILS } from "./notes.js";

const KEY = "status";
// wrangler.toml の crons と合わせる（次回の予定時刻 next_update_at の計算に使う）
const INTERVAL_MIN = 5;
// /health の判定。Cron が3回続けて動かない、または同じ事業者で3回続けて取得に失敗したら異常とする
const HEALTH_STALE_MIN = INTERVAL_MIN * 3 + 2;
const HEALTH_FAIL_COUNT = 3;

// /status.json を読めるのは自サイトと手元の確認用（localhost）だけにする
// Origin（なければ Referer）で見る。ヘッダーは偽れるので、他サイトへの埋め込みや流用を防ぐための節度としての制限
const SITE_ORIGIN = "https://realryo1.github.io";
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

// /status.json は日本国内のネットワーク（Cloudflare の判定した国が JP）にだけ返す
// 国外と判定された人（自国の SIM でローミング中など）には、ページが位置情報の許可を求め、約10km単位に丸めた現在地を ?lat=&lon= で付けてくる
// 座標も偽れるので、これも節度としての制限。範囲は朝鮮半島・台湾・中国・ロシアにかからない大まかな矩形を重ねたもの [南, 北, 西, 東]
const JAPAN = [
  [41.3, 45.7, 139.3, 149], // 北海道
  [26, 41.6, 132, 154], // 本州（広島・島根東部より東）・四国・小笠原
  [33.8, 35.8, 130.8, 132], // 山口・島根西部
  [30, 34, 128.5, 132], // 九州・五島・壱岐
  [34, 34.75, 129.1, 129.6], // 対馬
  [24, 30, 122.9, 131.5], // 沖縄・奄美・先島・大東
];

function inJapan(request, url) {
  if (request.cf?.country === "JP") return true;
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  return JAPAN.some(([s, n, w, e]) => lat >= s && lat <= n && lon >= w && lon <= e);
}

// KV の読み取りを抑えるため、isolate のメモリに60秒持つ（Cron が5分ごとなので十分新しい）
// workers.dev では Cache API が効かなかったためメモリにした（独自ドメインでは効くが、メモリで足りている）
const MEMO_MS = 60 * 1000;
let memo = null;

async function readStatus(env) {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.body;
  const body = await env.DELAY_KV.get(KEY).catch(() => null);
  if (body) memo = { body, at: Date.now() };
  return body || memo?.body || null;
}

function allowedOrigin(request) {
  const origin = request.headers.get("Origin");
  if (origin) return origin === SITE_ORIGIN || LOCAL_ORIGIN.test(origin) ? origin : null;
  const referer = request.headers.get("Referer");
  if (!referer) return null;
  try {
    const o = new URL(referer).origin;
    return o === SITE_ORIGIN || LOCAL_ORIGIN.test(o) ? o : null;
  } catch {
    return null;
  }
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    Vary: "Origin",
  };
}

function json(body, status, cacheControl, headers = {}) {
  return new Response(body, {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": cacheControl },
  });
}

// 異常（503 にする）：更新が止まっている／同じ事業者で続けて取得に失敗している／一部が読めない（構造変更の疑い）
// 1回だけの取得失敗は一時的なことが多いので 503 にはせず、notes に載せるだけにする
function health(data) {
  const problems = [];
  const notes = [];
  const age = (Date.now() - Date.parse(data.updated_at)) / 60000;
  if (!(age < HEALTH_STALE_MIN)) problems.push(`更新が止まっている（最終更新 ${data.updated_at}）`);
  const failCount = Object.fromEntries(Object.entries(data.services || {}).map(([id, svc]) => [id, svc.fail_count || 0]));
  for (const e of data.meta?.source_errors || []) {
    const text = `${e.id}: ${e.message}（${failCount[e.id]}回連続）`;
    (failCount[e.id] >= HEALTH_FAIL_COUNT ? problems : notes).push(text);
  }
  for (const w of data.meta?.source_warnings || []) problems.push(`${w.id}: ${w.message}`);
  // フェリーのお知らせの LLM（Haiku 5.5）：キーがない・同じお知らせで3回続けて失敗（前払いの残高切れを含む）なら異常、1〜2回なら notes
  // 失敗してもページは正規表現で読んだ便だけを出すので、ほかの事業者の取得失敗とは分けて数える
  for (const [id, l] of llmResults(data.services)) {
    if (l.ok) continue;
    const text = `${id}: LLM: ${l.error}${l.nokey ? "" : `（${l.fails}回連続）`}`;
    (l.nokey || l.fails >= LLM_MAX_FAILS ? problems : notes).push(text);
  }
  return { ok: problems.length === 0, updated_at: data.updated_at, problems, notes };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const prev = await env.DELAY_KV.get(KEY, "json").catch(() => null);
        const next = await collect(prev);
        // フェリーのお知らせの要約・補足を LLM で読む（平常時は呼ばず、本文が変わったときだけ呼ぶ）。失敗しても収集の結果は保存する
        try {
          await addNotes(env, next.services, prev?.services);
        } catch (e) {
          next.meta.source_errors.push({ id: "llm", message: `LLM: ${String(e?.message || e).slice(0, 180)}` });
        }
        // scheduledTime はこの回の予定時刻（例 21:02:00）。次の回はその INTERVAL_MIN 分後
        next.next_update_at = jstIso(new Date(event.scheduledTime + INTERVAL_MIN * 60000));
        await env.DELAY_KV.put(KEY, JSON.stringify(next));
      })()
    );
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // wrangler dev（localhost:8787）では curl などでそのまま見られるようにする
    const local = LOCAL_ORIGIN.test(url.origin);
    const origin = local ? request.headers.get("Origin") || "*" : allowedOrigin(request);

    if (request.method === "OPTIONS") {
      return origin ? new Response(null, { status: 204, headers: cors(origin) }) : new Response(null, { status: 403 });
    }
    if (request.method !== "GET") return json('{"error":"method not allowed"}', 405, "no-store");

    // レート制限は Worker の手前の WAF でかけている（Workers のリクエスト数に入らないため。document/delayProgress.md）

    // /health は外部の監視（Origin も Referer もなく、国外からのこともある）から見るので制限しない。CORS ヘッダーも付けない
    if (url.pathname === "/health") {
      const body = await readStatus(env);
      if (!body) return json('{"ok":false,"problems":["KV にデータがない"]}', 503, "no-store");
      const h = health(JSON.parse(body));
      return json(JSON.stringify(h), h.ok ? 200 : 503, "no-store");
    }
    if (url.pathname !== "/" && url.pathname !== "/status.json") return json('{"error":"not found"}', 404, "no-store");
    // 作者の確認用：環境変数 ALLOW_IPS（カンマ区切り。ダッシュボードの Variables and Secrets で設定し、リポジトリには書かない）の IP からは、
    // Origin・Referer がなくても（ブラウザで URL を直接開いても）返す
    const allowIp = (env.ALLOW_IPS || "").split(",").map((s) => s.trim()).filter(Boolean).includes(request.headers.get("CF-Connecting-IP"));
    if (allowIp && !origin) {
      const body = await readStatus(env);
      return body ? json(body, 200, "no-store") : json('{"error":"not ready"}', 503, "no-store");
    }
    if (!origin) return json('{"error":"forbidden"}', 403, "no-store");
    // ページが位置情報の確認に進めるよう、CORS ヘッダーを付けて理由（region）を返す
    if (!local && !inJapan(request, url)) return json('{"error":"region"}', 403, "no-store", cors(origin));

    const body = await readStatus(env);
    // 初回デプロイ直後で Cron がまだ一度も動いていないときは 503（ここで事業者へ取りに行くことはしない）
    if (!body) return json('{"error":"not ready"}', 503, "no-store", cors(origin));
    return json(body, 200, "public, max-age=60, stale-while-revalidate=300", cors(origin));
  },
};
