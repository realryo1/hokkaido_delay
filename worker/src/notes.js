// フェリーのお知らせの要約・補足を LLM（Claude Haiku 5.5）で読み、正規表現で読んだ便に重ねる
//   新日本海フェリー（お知らせごと。notices[].llm）・シルバーフェリー（お知らせ。services.silverferry.llm）・さんふらわあ（トップの欄。services.sunflower.llm）
//
// 役割の分担（document/delayProgress.md の「決めたこと」）
// - どの便が欠航・遅れかは正規表現で読み、これを確かな情報とする。LLM はその便の状態を変えられない
// - LLM は補足（出港定刻・出港や到着の時刻の変更・到着遅れ見込み・一部区間だけ運航・船名・バイク乗船不可など）と、
//   正規表現で読まない便（臨時便・代替便・振替先・船舶変更・出発港変更・正規表現で読めない書き方の便）、便を特定しない案内、要約を返す
// - 正規表現で読んだ便を番号付きで渡し、番号ごとの補足（known）と、一覧にない便（sailings）を返してもらう。
//   一覧と本文が食い違うと LLM が見たら、llm.known に mismatch として残す（ページにも /health にも出さない。空振りが多いため）
// - LLM が足した便は、日付・時刻が本文にあるときだけ使い、source: "llm" を付ける（ページで印を付ける）
// - 平常時は呼ばない（本文が渡されない）。本文のハッシュが前回と同じなら呼ばずに前回の結果を使う。
//   失敗は同じ本文で MAX_FAILS 回まで続けて試し、そのあとは1時間に1回
//   （前払いの残高が切れたときも失敗になり、ページは正規表現で読んだ便だけの表示に戻る。/health にも出る）
// API キーは Worker のシークレット ANT_API_TOKEN（手元では worker/.env）
import Anthropic from "@anthropic-ai/sdk";
import { noticeTexts } from "./noticeTexts.js";

export const LLM = { model: "claude-haiku-5-5", effort: "low" };
export const MAX_FAILS = 3; // index.js の /health でも使う（この回数に達したら異常）
const RETRY_MS = 60 * 60 * 1000;
// LLM が足した便の状態（正規表現の便の状態は変えない）
const KIND_STATUS = {
  欠航: "suspended",
  運休: "suspended",
  臨時便: "normal",
  代替便: "normal",
  振替: "normal",
  通常運航: "normal",
  出港済: "normal",
};
// 正規表現の便と同じ日・港・時刻でも、別の便として書かれたもの（補足を重ねない）
const SEPARATE = ["代替便", "振替", "船舶変更", "出発港変更"];

// 事業者ごとの設定。rules は便の書き方と kind の分け方（プロンプトに入る）
const OPS = {
  snf: {
    name: "新日本海フェリー",
    ports: ["小樽", "苫小牧東", "舞鶴", "敦賀", "新潟", "秋田"],
    alias: { 苫小牧: "苫小牧東" },
    portBeforeTime: true, // 本文で港名のすぐ後に時刻がある（「小樽23:30発」）
    runsTo: true,
    kinds: ["欠航", "遅れ", "臨時便", "代替便", "振替", "通常運航", "船舶変更", "出発港変更", "その他"],
    notes: ["バイク乗船不可", "行先変更の可能性", "寄港しない港あり", "到着遅れの可能性"],
    rules: `- 便は「・1月9日（金）苫小牧東港23:30発→敦賀行」のような行。経由便の to は最後の港
- kind：その便が書かれている見出し（欠航／運航遅れ・遅延・出港定刻・到着遅れ・行先変更の可能性→遅れ／臨時便運航→臨時便／代替便のご案内→代替便／「⇒」で示された振替先→振替／通常運航／運航船舶変更→船舶変更／出発港変更）。どれにも当たらなければ「その他」
- 見出しが続けていくつも並んでいるとき（例「●出港定刻」「●到着遅れの可能性あり」「●行先を小樽に変更する可能性あり」）は、その下の便にすべての見出しを当てはめる
- runs_to：便の行の後ろに「（苫小牧東港→新潟は運航いたします）」「（※敦賀→新潟・苫小牧東港は運航いたします）」のように一部区間だけ運航すると書かれていれば、運航する行き先の港（例 ["新潟"]）。便の行の後ろにないものは使わない。日付のない「（※…は運航いたします）」が独立した行にあり、どの便のことか確かでなければ、どの便にも付けない
- notes：津波などで「行先を小樽に変更する可能性あり」の見出しの下にある便には「行先変更の可能性」を付ける`,
  },
  silverferry: {
    name: "シルバーフェリー（八戸〜苫小牧）",
    ports: ["八戸", "苫小牧"],
    alias: {},
    kinds: ["欠航", "運休", "遅れ", "出港済", "通常運航", "状況確認中", "その他"],
    notes: ["到着遅れの可能性"],
    rules: `- 便は【7月30日（水）】の日付と「＜八戸発＞」「＜苫小牧発＞」の下の「08:45発便 シルバープリンセス 欠航」のような行。to はもう一方の港
- kind：行の状態の語（欠航→欠航／定期検査運休・運休→運休／入港遅延・遅れ→遅れ／出港済→出港済／通常運航・運航予定→通常運航／状況確認中→状況確認中）。どれにも当たらなければ「その他」
- 「以降全便通常運航予定」のように便を特定しない行は、sailings に入れず general に入れる`,
  },
  sunflower: {
    name: "さんふらわあ（大洗〜苫小牧）",
    ports: ["大洗", "苫小牧"],
    alias: {},
    kinds: ["欠航", "遅れ", "臨時便", "通常運航", "状況未定", "その他"],
    notes: ["船舶入替", "到着遅れの可能性", "乗船手続きの時刻変更"],
    rules: `- 便は「＜大洗発＞」「＜苫小牧発＞」の下の「11月18日（水） 深夜便01:45発 さんふらわあ かむい 欠航」のような行。to はもう一方の港。行に日付がない書き方では、上にある日付（【7月31日(木)】や「3月6日（木）」の行）を使う。出港の時刻が書かれていない便は入れない
- kind：行の状態の語（欠航→欠航／臨時便運航・臨時運航→臨時便／遅延・遅れ→遅れ／定刻出港予定・運航予定・出港済→通常運航／未定・天候調査中→状況未定）。どれにも当たらなければ「その他」
- notes：「※船舶入替」や「〜で運航」（別の船で運航する）なら「船舶入替」
- general：定期的な出港時刻の変更（例「1〜3月の毎週日曜の苫小牧発深夜便は00:10発」）など運航に関わる案内は入れる。船内・グッズ・下船に時間がかかること・予約センターの案内は入れない`,
  },
};

const AT = {
  type: "object",
  properties: { month: { type: "integer" }, day: { type: "integer" }, time: { type: "string" }, done: { type: "boolean" } },
  required: ["month", "day", "time", "done"],
  additionalProperties: false,
};

// 構造化出力の形（返答はこの形の JSON になる）
// known：正規表現で読んだ便（番号付きで渡す）への補足と食い違い。sailings：渡した一覧にない便
function schema(op) {
  const extra = {
    depart: { type: "string", enum: ["定刻", "遅れ"] },
    depart_at: AT,
    arrive: { type: "string", enum: ["遅れ見込み"] },
    arrive_at: AT,
    ...(op.runsTo ? { runs_to: { type: "array", items: { type: "string", enum: op.ports } } } : {}),
    ship: { type: "string" },
    notes: { type: "array", items: { type: "string", enum: op.notes } },
  };
  const sailing = {
    month: { type: "integer" },
    day: { type: "integer" },
    from: { type: "string", enum: op.ports },
    time: { type: "string" },
    to: { type: "string", enum: op.ports },
    kind: { type: "string", enum: op.kinds },
    ...extra,
  };
  return {
    type: "object",
    properties: {
      summary: {
        type: "array",
        items: {
          type: "object",
          properties: { month: { type: "integer" }, day: { type: "integer" }, label: { type: "string" }, text: { type: "string" } },
          required: ["month", "day", "label", "text"],
          additionalProperties: false,
        },
      },
      known: {
        type: "array",
        items: { type: "object", properties: { id: { type: "integer" }, ...extra, mismatch: { type: "string" } }, required: ["id"], additionalProperties: false },
      },
      sailings: {
        type: "array",
        items: { type: "object", properties: sailing, required: ["month", "day", "from", "time", "to", "kind"], additionalProperties: false },
      },
      general: { type: "array", items: { type: "string" } },
    },
    required: ["summary", "known", "sailings", "general"],
    additionalProperties: false,
  };
}

// ユーザーの発言：お知らせの本文と、正規表現で読んだ便の一覧（番号付き）
function userText(text, regex) {
  const list = (regex || []).map((s, i) => `${i + 1}: ${s.date} ${s.from}→${s.to} ${s.time}発 ${s.label}`).join("\n");
  return `【お知らせの本文】\n${text}\n\n【正規表現で読んだ便】\n${list || "（なし）"}`;
}

const system = (op) => `あなたはフェリーの運航のお知らせから事実だけを取り出す係です。ユーザーが渡すお知らせ（${op.name}）の本文と、プログラムが正規表現で本文から読んだ便の一覧（番号付き）を読み、決められた形の JSON で返してください。
- 本文に書かれていないことは書かない。推測しない
- known：一覧の便のうち、下の補足（depart・depart_at・arrive・arrive_at${op.runsTo ? "・runs_to" : ""}・ship・notes）が本文にある便を、一覧の番号（id）を付けて返す。補足がない便は返さない。一覧の日付・港・時刻・状態が本文と食い違っていれば、mismatch にどう違うかを40字以内で書く（例「本文では欠航」）。言い方が違うだけ（「通常運航予定」と「運航予定」、「入港遅延」と「遅れ見込み」など）は食い違いではない。食い違いがなければ mismatch は省く
- sailings：一覧にない便だけ。一覧は読み落としや書き間違いの読み飛ばしがあるので、本文の便を一つずつ一覧と照らし、ないものは必ずここに入れる（日付の数字が欠けているなど書き間違いの行も、本文から分かる範囲で入れる。出港時刻が書かれておらず到着時刻しか分からない便は入れない）。month・day は本文の日付、time は時刻表どおりの出港時刻（例 "23:30"。早出し・遅れなどで変わった時刻は time ではなく depart_at に入れる）、from・to は港（${op.ports.join("・")}。「港」は付けない）。1行に複数の便が書かれていれば、便ごとに分ける
${op.rules}
- 補足は、その便について本文にはっきり書かれていることだけ。本文に書かれていない補足は付けない（欠航の便に出港の補足を付けない。「入港遅延」は到着の遅れで、出港の遅れではない）
- depart：その便の出港について「出港定刻」「定刻出港」とあれば定刻、「出港遅れ」「○時発（○時間遅延）」のように出港が遅れると書かれていれば遅れ。書かれていなければ省く
- depart_at：時刻表と違う出港の時刻が書かれていれば（例「3日13:00出港予定」「14:20出港済」）、その日付と時刻。出港済なら done を true。時刻表どおりの時刻は入れない。なければ省く
- arrive：到着（入港）が遅れる見込み・予定と書かれていれば遅れ見込み。「遅れの可能性」「遅延の可能性」だけなら arrive は付けず notes の「到着遅れの可能性」にする。なければ省く
- arrive_at：到着（入港）の予定や実際の時刻が書かれていれば（例「4月21日(火)03:15入港予定」「22:00頃着予定」）、その日付と時刻（日付が書かれていなければ、時刻から考えて出港の日か翌日）。到着済・入港済なら done を true。なければ省く
- ship：船名が書かれていれば（例 "けやき"）。なければ省く
- notes：本文にあれば ${op.notes.map((n) => `「${n}」`).join("")}（arrive を付けた便には「到着遅れの可能性」は付けない）。なければ省く
- summary：運航への影響の要点を、日付ごとの項目で。便の欠航・運航・遅れがある日には、すべて1日に1項目を作る（label は「11月18日」）。何日にもまたがること（例「船舶を入れ替えて運航する」）は、それとは別に、その日付をまとめた1項目（label は「11月19日・20日」）にする（まとめた項目があっても、その日の便のことはその日の項目に書く）。便の欠航・運航を書くときは、一覧の状態と本文の両方で確かめたことだけを、どの港発のどの便か（深夜便・時刻など）で書く。「6便欠航」「計4便」のような便の数は書かない（数え間違えるため）。month・day は label の最初の日。text は要点を60字以内で、label の日付は text に繰り返さない。理由（低気圧・津波など）は最初の項目の text に入れる。本文にない日付を補わない。お詫び・手続きの方法・問い合わせ先は入れない
- general：日付に結び付かない運航の案内（例「その他の便も遅れる場合がある」や、期間を決めた出港時刻の変更）を、1つ60字以内で。summary に書いたことは繰り返さない。どの便が欠航・運航するかは sailings に書き、general には書かない。本文にない日付を補わない。お詫び・手続きの方法・問い合わせ先・「○時現在の情報」は入れない`;
// 指示（プロンプト・形）の版。本文のハッシュに混ぜるので、上げると今出ているお知らせも1回だけ読み直す
const PROMPT_VERSION = 2;

const pad = (n) => String(n).padStart(2, "0");

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 返答を確かめて、使えるものだけを残す。日付・時刻が本文にない便は捨てる。posted はお知らせの日付（年を決めるのに使う）
// regex は渡した正規表現の便の一覧。known は番号ではなく日付・港・時刻で持つ（正規表現を直して順番が変わっても前回の結果を使えるように）
export function validate(op, raw, text, posted, regex = []) {
  const year = +posted.slice(0, 4);
  const month = +posted.slice(5, 7);
  const iso = (m, d) => `${m < month - 6 ? year + 1 : m > month + 6 ? year - 1 : year}-${pad(m)}-${pad(d)}`;
  const flat = text.replace(/[０-９：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\s+/g, "");
  const port = (s) => {
    const p = String(s || "").trim().replace(/港$/, "");
    const q = op.alias[p] || p;
    return op.ports.includes(q) ? q : null;
  };
  const hm = (s) => /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  const inText = (t, before = "") => new RegExp(`${before}0?${+t[1]}:${t[2]}`).test(flat);
  // 出港・到着の時刻（本文に時刻があるものだけ）
  const at = (a) => {
    const t = hm(a?.time);
    if (!t || !(a.month >= 1 && a.month <= 12 && a.day >= 1 && a.day <= 31) || !inText(t)) return null;
    return { at: `${iso(+a.month, +a.day)}T${pad(t[1])}:${t[2]}`, done: !!a.done };
  };
  const clip = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);
  // 補足（本文で確かめられるものだけ）。base は便の日付と時刻（時刻表どおりの出港時刻を depart_at として返してきたら捨てる）
  const extras = (s, base) => {
    const item = {};
    if (s.depart === "定刻" || s.depart === "遅れ") item.depart = s.depart;
    const dep = at(s.depart_at);
    if (dep && dep.at !== `${base.date}T${base.time}`) item.depart_at = dep;
    if (s.arrive === "遅れ見込み") item.arrive = s.arrive;
    const arr = at(s.arrive_at);
    if (arr) item.arrive_at = arr;
    const runs = (Array.isArray(s.runs_to) ? s.runs_to : []).map(port).filter(Boolean);
    if (op.runsTo && runs.length) item.runs_to = [...new Set(runs)];
    const ship = String(s.ship || "").trim();
    if (ship && ship.length <= 12 && flat.includes(ship.replace(/\s+/g, ""))) item.ship = ship;
    const notes = (Array.isArray(s.notes) ? s.notes : []).filter((x) => op.notes.includes(x) && !(item.arrive && x === "到着遅れの可能性"));
    if (notes.length) item.notes = [...new Set(notes)];
    return item;
  };
  const known = [];
  for (const k of Array.isArray(raw?.known) ? raw.known : []) {
    const r = regex[+k.id - 1];
    if (!r) continue;
    const item = { date: r.date, from: r.from, time: r.time, to: r.to, ...extras(k, r) };
    const mismatch = clip(k.mismatch, 60);
    if (mismatch) item.mismatch = mismatch;
    if (Object.keys(item).length > 4) known.push(item);
  }
  const sailings = [];
  for (const s of Array.isArray(raw?.sailings) ? raw.sailings : []) {
    const m = +s.month;
    const d = +s.day;
    const from = port(s.from);
    const to = port(s.to);
    const t = hm(s.time);
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && from && to && from !== to && t && op.kinds.includes(s.kind))) continue;
    // 本文に「日付」と「時刻」があるか（新日本海フェリーは「港＋時刻」。「／19日（火）秋田港6:15発」のような書き方もあるので、日は「19日」で見る）
    if (!flat.includes(`${d}日`) || !inText(t, op.portBeforeTime ? `${from}港?` : "")) continue;
    // 出港時刻であること（時刻のすぐ後に「発」「便発」がある）。到着時刻（「20:15着」）を出港時刻と取り違えた便を捨てる
    if (!new RegExp(`0?${+t[1]}:${t[2]}便?発`).test(flat)) continue;
    const base = { date: iso(m, d), time: `${pad(t[1])}:${t[2]}` };
    sailings.push({ ...base, from, to, kind: s.kind, ...extras(s, base) });
  }
  const general = (Array.isArray(raw?.general) ? raw.general : []).map((g) => clip(g, 80)).filter(Boolean).slice(0, 5);
  // 要約は日付ごとの項目（{ date, label, text }）。日付の順に並べ、日付が読めない項目は捨てる
  const summary = (Array.isArray(raw?.summary) ? raw.summary : [])
    .filter((x) => x.month >= 1 && x.month <= 12 && x.day >= 1 && x.day <= 31 && clip(x.text, 1))
    .map((x) => ({ date: iso(+x.month, +x.day), label: clip(x.label, 20) || `${+x.month}月${+x.day}日`, text: clip(x.text, 80) }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 8);
  return { summary, known, sailings, general };
}

// 正規表現の便に LLM の補足を重ね、正規表現にない便を source: "llm" で足す（状態は正規表現の便のまま）
export function merge(sailings, llm) {
  const out = (sailings || []).map((s) => ({ ...s }));
  const regex = out.slice();
  // 番号で返ってきた補足（日付・港・時刻・行き先で正規表現の便に重ねる）。
  // 食い違い（mismatch）は llm.known に残すだけで、便には付けない（2026-11-19 の試験では空振りが多かったため。正規表現の読み間違いを探す手がかりにする）
  for (const k of llm.known || []) {
    const hit = regex.find((s) => s.date === k.date && s.from === k.from && s.time === k.time && s.to === k.to);
    if (!hit) continue;
    const { date, from, time, to, mismatch, ...extra } = k;
    if (extra.runs_to && [hit.to, ...(hit.via || [])].every((p) => extra.runs_to.includes(p))) delete extra.runs_to;
    if (hit.ship) delete extra.ship;
    Object.assign(hit, extra);
  }
  // 一覧にない便として返ってきたもの。正規表現の便と同じ日・港・時刻なら補足として重ねる
  for (const x of llm.sailings) {
    const extra = {};
    for (const k of ["depart", "depart_at", "arrive", "arrive_at", "runs_to", "ship", "notes"]) if (x[k]) extra[k] = x[k];
    // 同じ日・港・時刻の正規表現の便（経由便は行き先が分かれて書かれることがあるので、行き先が同じものを優先）
    const same = regex.filter((s) => s.date === x.date && s.from === x.from && s.time === x.time);
    const hit = same.find((s) => s.to === x.to) || same[0];
    if (hit) {
      // 一部区間だけ運航の行き先が、便の行き先・経由地をすべて含むなら、欠航と食い違うので使わない
      if (extra.runs_to && [hit.to, ...(hit.via || [])].every((p) => extra.runs_to.includes(p))) delete extra.runs_to;
      // 船名は正規表現で読んだものを使う
      if (hit.ship) delete extra.ship;
      // 同じ便が「代替便」などとして別に書かれていたら重ねない。状態は変えない
      if (!SEPARATE.includes(x.kind)) Object.assign(hit, extra);
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

async function ask(client, op, text, regex) {
  const res = await client.messages.create({
    model: LLM.model,
    // 考える段階（既定で有効）も max_tokens に含まれる
    max_tokens: 8000,
    output_config: { effort: LLM.effort, format: { type: "json_schema", schema: schema(op) } },
    system: system(op),
    messages: [{ role: "user", content: userText(text, regex) }],
  });
  if (res.stop_reason !== "end_turn") throw new Error(`返答が途中で終わった（stop_reason: ${res.stop_reason}）`);
  const out = res.content.find((b) => b.type === "text")?.text;
  if (!out) throw new Error("答えが空");
  return { raw: JSON.parse(out), usage: res.usage };
}

// 1つのお知らせを読む。holder は llm を付けて sailings に重ねる先（新日本海フェリーはお知らせ、ほかはサービス）
async function readOne(client, id, holder, text, posted, prevHolder, onUsage) {
  const op = OPS[id];
  const hash = await sha256(`${PROMPT_VERSION}\n${text}`);
  const old = prevHolder?.llm?.hash === hash ? prevHolder.llm : null;
  let llm = old;
  // キーがなくて呼べなかったとき（nokey）は、キーを置いたら次の回に呼ぶ。
  // MAX_FAILS 回続けて失敗したら、残高を足したときなどに戻るよう、1時間に1回だけ呼び直す
  const retry = old && !old.ok && (old.nokey || old.fails < MAX_FAILS || Date.now() - Date.parse(old.failed_at) >= RETRY_MS);
  if (!old || retry) {
    if (!client) {
      holder.llm = { hash, ok: false, nokey: true, model: LLM.model, error: "API キー（ANT_API_TOKEN）がない" };
      return;
    }
    try {
      // 正規表現の便（重ねる前のもの）も渡す。本文が同じなら正規表現の結果も同じなので、使い回しはハッシュのままでよい
      const regex = Array.isArray(holder.sailings) ? holder.sailings : [];
      const { raw, usage } = await ask(client, op, text, regex);
      onUsage?.(id, usage);
      llm = { hash, ok: true, model: LLM.model, ...validate(op, raw, text, posted, regex) };
    } catch (e) {
      // API のエラーは「400 invalid_request_error: Your credit balance is too low …」の形にする（/health に出る）
      const api = e?.error?.error;
      const error = api?.message ? `${e.status} ${api.type}: ${api.message}` : String(e?.message || e);
      llm = { hash, ok: false, fails: (old?.nokey ? 0 : old?.fails || 0) + 1, failed_at: new Date().toISOString(), model: LLM.model, error: error.slice(0, 200) };
    }
  }
  holder.llm = llm;
  if (llm.ok && Array.isArray(holder.sailings)) holder.sailings = merge(holder.sailings, llm);
}

// services は今回の collect の結果、prev は前回の services。本文（noticeTexts）があるものだけ読む。並べて呼ぶ
// onUsage は手元の試験用（トークン数を表示する）
export async function addNotes(env, services, prev, onUsage) {
  const client = env.ANT_API_TOKEN ? new Anthropic({ apiKey: env.ANT_API_TOKEN, timeout: 60000, maxRetries: 1 }) : null;
  const jobs = [];
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const snf = services?.snf;
  if (snf?.ok && Array.isArray(snf.notices)) {
    for (const n of snf.notices) {
      const text = noticeTexts.get(`snf ${n.url}`);
      const prevN = (prev?.snf?.notices || []).find((p) => p.url === n.url);
      if (text) jobs.push(readOne(client, "snf", n, text, n.date || today, prevN, onUsage));
    }
  }
  for (const id of ["silverferry", "sunflower"]) {
    const svc = services?.[id];
    const text = noticeTexts.get(id);
    if (svc?.ok && text) jobs.push(readOne(client, id, svc, text, svc.posted || today, prev?.[id], onUsage));
  }
  await Promise.all(jobs);
}

// /health 用：LLM の結果がある場所（[id, llm] の配列）
export function llmResults(services) {
  const out = (services?.snf?.notices || []).map((n) => ["snf", n.llm]);
  for (const id of ["silverferry", "sunflower"]) out.push([id, services?.[id]?.llm]);
  return out.filter(([, l]) => l);
}
