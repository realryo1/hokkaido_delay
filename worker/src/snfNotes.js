// 新日本海フェリーのお知らせの補足を LLM（Claude Haiku 5.5）で読み、正規表現で読んだ便（snf.js）に重ねる
//
// 役割の分担（document/delayProgress.md の「決めたこと」）
// - どの便が欠航・遅れかは正規表現で読み、これを確かな情報とする。LLM はその便の状態を変えられない
// - LLM は補足（出港定刻・到着遅れ見込み・一部区間だけ運航・バイク乗船不可・行先変更の可能性・船名）と、
//   正規表現で読まない便（臨時便・代替便・振替先・船舶変更・出発港変更・箇条書きでない便）、便を特定しない案内、要約を返す
// - LLM が足した便は、日付・港・時刻が本文にあるときだけ使い、source: "llm" を付ける（ページで印を付ける）
// - 本文のハッシュが前回と同じなら呼ばずに前回の結果を使う。失敗は同じ本文で MAX_FAILS 回まで続けて試し、そのあとは1時間に1回
//   （前払いの残高が切れたときも失敗になり、ページは正規表現で読んだ便だけの表示に戻る。/health にも出る）
// API キーは Worker のシークレット ANT_API_TOKEN（手元では worker/.env）
import Anthropic from "@anthropic-ai/sdk";
import { noticeTexts } from "./sources/snf.js";

export const LLM = { model: "claude-haiku-5-5", effort: "low" };
export const MAX_FAILS = 3; // index.js の /health でも使う（この回数に達したら異常）
const RETRY_MS = 60 * 60 * 1000;
const PORTS = ["小樽", "苫小牧東", "舞鶴", "敦賀", "新潟", "秋田"];
const KINDS = ["欠航", "遅れ", "臨時便", "代替便", "振替", "通常運航", "船舶変更", "出発港変更", "その他"];
const NOTES = ["バイク乗船不可", "行先変更の可能性", "寄港しない港あり", "到着遅れの可能性"];
// LLM が足した便の状態（正規表現の便の状態は変えない）
const KIND_STATUS = { 欠航: "suspended", 遅れ: "delay", 臨時便: "normal", 代替便: "normal", 振替: "normal", 通常運航: "normal" };

// 構造化出力の形（返答はこの形の JSON になる）
const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    sailings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          month: { type: "integer" },
          day: { type: "integer" },
          from: { type: "string", enum: PORTS },
          time: { type: "string" },
          to: { type: "string", enum: PORTS },
          kind: { type: "string", enum: KINDS },
          depart: { type: "string", enum: ["定刻", "遅れ"] },
          arrive: { type: "string", enum: ["遅れ見込み"] },
          runs_to: { type: "array", items: { type: "string", enum: PORTS } },
          ship: { type: "string" },
          notes: { type: "array", items: { type: "string", enum: NOTES } },
        },
        required: ["month", "day", "from", "time", "to", "kind"],
        additionalProperties: false,
      },
    },
    general: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "sailings", "general"],
  additionalProperties: false,
};

const SYSTEM = `あなたはフェリーの運航のお知らせから事実だけを取り出す係です。ユーザーが渡すお知らせ（新日本海フェリー）を読み、決められた形の JSON で返してください。
- 本文に書かれていないことは書かない。推測しない
- sailings：本文に出てくる便をすべて。month・day は本文の日付、time は出港時刻（例 "23:30"）、from・to は港（${PORTS.join("・")}。「港」は付けない。経由便の to は最後の港）。1行に複数の便が書かれていれば、便ごとに分ける
- kind：その便が書かれている見出し（欠航／運航遅れ・遅延・出港定刻・到着遅れ・行先変更の可能性→遅れ／臨時便運航→臨時便／代替便のご案内→代替便／「⇒」で示された振替先→振替／通常運航／運航船舶変更→船舶変更／出発港変更）。どれにも当たらなければ「その他」
- depart：「出港定刻」なら定刻、「出港遅れ」なら遅れ。書かれていなければ省く
- arrive：「到着遅れ」の見込み・予定と書かれていれば遅れ見込み。なければ省く
- runs_to：便の行の後ろに「（苫小牧東港→新潟は運航いたします）」「（※敦賀→新潟・苫小牧東港は運航いたします）」のように一部区間だけ運航すると書かれていれば、運航する行き先の港（例 ["新潟"]）。便の行の後ろにないものは使わない。日付のない「（※…は運航いたします）」が独立した行にあり、どの便のことか確かでなければ、どの便にも付けない
- ship：船名が書かれていれば（例 "けやき"）。なければ省く
- 見出しが続けていくつも並んでいるとき（例「●出港定刻」「●到着遅れの可能性あり」「●行先を小樽に変更する可能性あり」）は、その下の便にすべての見出しを当てはめる
- notes：本文にあれば「バイク乗船不可」「行先変更の可能性」「寄港しない港あり」「到着遅れの可能性」（arrive を付けた便には「到着遅れの可能性」は付けない）。津波などで「行先を小樽に変更する可能性あり」の見出しの下にある便には「行先変更の可能性」を付ける。なければ省く
- general：特定の便に結び付かない運航の案内（例「2月19日の北海道発本州行は手数料なしで変更・取消できる」）を、1つ60字以内で。どの便が欠航・運航するかは sailings に書き、general には書かない。本文にない日付を補わない。お詫び・手続きの方法・問い合わせ先・「○時現在の情報」は入れない
- summary：運航への影響の要点を120字以内の日本語で。本文にない日付を補わない。お詫び・手続きの方法・問い合わせ先は入れない`;

const pad = (n) => String(n).padStart(2, "0");

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 港名をそろえる（「苫小牧東港」→「苫小牧東」、「苫小牧」→「苫小牧東」）。知らない港は null
function port(s) {
  const p = String(s || "").trim().replace(/港$/, "");
  if (p === "苫小牧") return "苫小牧東";
  return PORTS.includes(p) ? p : null;
}

// 返答を確かめて、使えるものだけを残す。日付・港・時刻が本文にない便は捨てる
export function validate(raw, text, posted) {
  const year = +posted.slice(0, 4);
  const month = +posted.slice(5, 7);
  const iso = (m, d) => `${m < month - 6 ? year + 1 : m > month + 6 ? year - 1 : year}-${pad(m)}-${pad(d)}`;
  const flat = text.replace(/[０-９：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\s+/g, "");
  const sailings = [];
  for (const s of Array.isArray(raw?.sailings) ? raw.sailings : []) {
    const m = +s.month;
    const d = +s.day;
    const from = port(s.from);
    const to = port(s.to);
    const t = /^(\d{1,2}):(\d{2})$/.exec(String(s.time || "").trim());
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && from && to && t && KINDS.includes(s.kind))) continue;
    // 本文に「日付」と「港＋時刻」があるか（「／19日（火）秋田港6:15発」のような書き方もあるので、日は「19日」で見る）
    const at = new RegExp(`${from}港?0?${+t[1]}:${t[2]}`);
    if (!flat.includes(`${d}日`) || !at.test(flat)) continue;
    const item = { date: iso(m, d), from, to, time: `${pad(t[1])}:${t[2]}`, kind: s.kind };
    if (s.depart === "定刻" || s.depart === "遅れ") item.depart = s.depart;
    if (s.arrive === "遅れ見込み") item.arrive = s.arrive;
    const runs = (Array.isArray(s.runs_to) ? s.runs_to : []).map(port).filter(Boolean);
    if (runs.length) item.runs_to = [...new Set(runs)];
    const ship = String(s.ship || "").trim();
    if (ship && ship.length <= 10 && flat.includes(ship)) item.ship = ship;
    const notes = (Array.isArray(s.notes) ? s.notes : []).filter((x) => NOTES.includes(x) && !(item.arrive && x === "到着遅れの可能性"));
    if (notes.length) item.notes = [...new Set(notes)];
    sailings.push(item);
  }
  const clip = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
  const general = (Array.isArray(raw?.general) ? raw.general : []).map((g) => clip(g, 80)).filter(Boolean).slice(0, 5);
  return { summary: clip(raw?.summary, 160), sailings, general };
}

// 正規表現の便に LLM の補足を重ね、正規表現にない便を source: "llm" で足す（状態は正規表現の便のまま）
export function merge(sailings, llm) {
  const out = (sailings || []).map((s) => ({ ...s }));
  const regex = out.slice();
  for (const x of llm.sailings) {
    const extra = {};
    for (const k of ["depart", "arrive", "runs_to", "ship", "notes"]) if (x[k]) extra[k] = x[k];
    // 同じ日・港・時刻の正規表現の便（経由便は行き先が分かれて書かれることがあるので、行き先が同じものを優先）
    const same = regex.filter((s) => s.date === x.date && s.from === x.from && s.time === x.time);
    const hit = same.find((s) => s.to === x.to) || same[0];
    if (hit) {
      // 一部区間だけ運航の行き先が、便の行き先・経由地をすべて含むなら、欠航と食い違うので使わない
      if (extra.runs_to && [hit.to, ...(hit.via || [])].every((p) => extra.runs_to.includes(p))) delete extra.runs_to;
      // 欠航・遅れ（と分けられなかった見出し）の補足だけを重ねる。同じ便が「代替便」などとして別に書かれていても重ねず、状態も変えない
      if (x.kind === "欠航" || x.kind === "遅れ" || x.kind === "その他") Object.assign(hit, extra);
      continue;
    }
    if (out.some((s) => s.source === "llm" && s.date === x.date && s.from === x.from && s.time === x.time && s.to === x.to)) continue;
    out.push({
      date: x.date,
      from: x.from,
      to: x.to,
      via: [],
      time: x.time,
      status: KIND_STATUS[x.kind] || "delay",
      label: x.kind,
      ...extra,
      source: "llm",
    });
  }
  return out;
}

async function ask(client, text) {
  const res = await client.messages.create({
    model: LLM.model,
    // 考える段階（既定で有効）も max_tokens に含まれる
    max_tokens: 8000,
    output_config: { effort: LLM.effort, format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: text }],
  });
  if (res.stop_reason !== "end_turn") throw new Error(`返答が途中で終わった（stop_reason: ${res.stop_reason}）`);
  const out = res.content.find((b) => b.type === "text")?.text;
  if (!out) throw new Error("答えが空");
  return { raw: JSON.parse(out), usage: res.usage };
}

// svc は今回の services.snf（collect の結果）。prevSvc は前回の services.snf。notices[] に llm を付け、sailings に重ねる
// onUsage は手元の試験用（トークン数を表示する）
export async function addSnfNotes(env, svc, prevSvc, onUsage) {
  if (!svc?.ok || !Array.isArray(svc.notices)) return;
  const client = env.ANT_API_TOKEN ? new Anthropic({ apiKey: env.ANT_API_TOKEN, timeout: 60000, maxRetries: 1 }) : null;
  for (const n of svc.notices) {
    const text = noticeTexts.get(n.url);
    if (!text) continue;
    const hash = await sha256(text);
    const old = (prevSvc?.notices || []).find((p) => p.url === n.url && p.llm?.hash === hash)?.llm;
    let llm = old;
    // キーがなくて呼べなかったとき（nokey）は、キーを置いたら次の回に呼ぶ。
    // MAX_FAILS 回続けて失敗したら、残高を足したときなどに戻るよう、1時間に1回だけ呼び直す
    const retry = old && !old.ok && (old.nokey || old.fails < MAX_FAILS || Date.now() - Date.parse(old.failed_at) >= RETRY_MS);
    if (!old || retry) {
      if (!client) {
        n.llm = { hash, ok: false, nokey: true, model: LLM.model, error: "API キー（ANT_API_TOKEN）がない" };
        continue;
      }
      try {
        const { raw, usage } = await ask(client, text);
        onUsage?.(usage);
        llm = { hash, ok: true, model: LLM.model, ...validate(raw, text, n.date) };
      } catch (e) {
        // API のエラーは「400 invalid_request_error: Your credit balance is too low …」の形にする（/health に出る）
        const api = e?.error?.error;
        const error = api?.message ? `${e.status} ${api.type}: ${api.message}` : String(e?.message || e);
        llm = { hash, ok: false, fails: (old?.nokey ? 0 : old?.fails || 0) + 1, failed_at: new Date().toISOString(), model: LLM.model, error: error.slice(0, 200) };
      }
    }
    n.llm = llm;
    if (llm.ok && Array.isArray(n.sailings)) n.sailings = merge(n.sailings, llm);
  }
}
