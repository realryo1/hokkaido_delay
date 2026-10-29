// 札幌丘珠空港：丘珠空港ビル公式サイトの「本日のフライト情報」（HTML の表）
//   <table id="dep_table"> / <table id="arr_table">（全社の出発・到着。JAL・FDA・TOK ごとの表は同じ便の再掲なので使わない）
//   <tr class="flight_data"><td class="number">2721便</td><td class="airlines_name"><img src="/flight/img/jal_logo.png" …></td>
//     <td class="place">女満別</td><td class="ontime">9:05</td><td class="change_time">10:00</td><td class="remarks">欠航</td></tr>
// 変更時刻が空なら定刻どおり。備考は「欠航」「出発済み」「到着済み」「目的地天候不良」など（2026-10-29 の実物で確認）。
// 航空会社は社名の文字ではなくロゴ画像の名前（jal_logo.png など）で分かる。HAC（北海道エアシステム）の便も JAL の便名・ロゴで載る。
// 便が1件もないときは表の中に「現在フライト情報はありません。」の行が入る（FDA は夏ダイヤのみで、冬は常にこの表示）。
// 備考の文言は取り込まず、こちらで決めた種類（欠航・遅れ・引き返し等・済み）に分類する。表示の形は新千歳空港（airport.js）と同じ。
import { get } from "../http.js";

const PAGE = "https://okadama-airport.co.jp/flight/";

// ロゴ画像の名前 → 系列（flight の先頭3文字は画面の色分けと社名の表示に使う）
const GROUPS = {
  jal: { name: "JAL・HAC（北海道エアシステム）", code: "JAL", airline: "JAL・HAC" },
  tok: { name: "トキエア", code: "TOK", airline: "トキエア" },
  fda: { name: "フジドリームエアラインズ", code: "FDA", airline: "FDA" },
};

const pad = (hm) => hm.replace(/^(\d):/, "0$1:");
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/[\s　\xa0]+/g, " ").trim();

function classify(remark, done) {
  if (/欠航/.test(remark)) return "cancelled";
  if (/天候不良|引き?返|ダイバート|目的地変更/.test(remark)) return "diverted";
  if (/遅れ|遅延/.test(remark)) return "delayed";
  return done ? "done" : "normal";
}

// 定刻と変更時刻の差（分）。日付をまたぐ（23:50 → 00:20）場合は翌日として数える
function delayMin(st, et) {
  if (!st || !et) return null;
  const m = (hm) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
  let d = m(et) - m(st);
  if (d < -12 * 60) d += 24 * 60;
  return Number.isFinite(d) ? d : null;
}

// 1つの表（出発または到着）から便を読む。表が見つからなければ null（構造が変わった疑い）
export function parseTable(html, id, dir) {
  const table = new RegExp(`<table id="${id}">([\\s\\S]*?)</table>`).exec(html)?.[1];
  if (table == null) return null;
  const flights = [];
  for (const row of table.matchAll(/<tr class="flight_data">([\s\S]*?)<\/tr>/g)) {
    const cell = {};
    for (const [, cls, inner] of row[1].matchAll(/<td class="([a-z_]+)"[^>]*>([\s\S]*?)<\/td>/g)) cell[cls] = inner;
    const number = /^(\d+)/.exec(text(cell.number || ""))?.[1];
    const scheduled = /^\d{1,2}:\d{2}$/.test(text(cell.ontime || "")) ? pad(text(cell.ontime)) : null;
    if (!number || !scheduled) continue;
    const logo = /\/(\w+?)_logo\./.exec(cell.airlines_name || "")?.[1];
    const estimatedRaw = text(cell.change_time || "");
    const remark = text(cell.remarks || "");
    flights.push({
      dir,
      group: GROUPS[logo] ? logo : "other",
      number,
      place: text(cell.place || ""),
      scheduled,
      estimated: /^\d{1,2}:\d{2}$/.test(estimatedRaw) ? pad(estimatedRaw) : null,
      remark,
    });
  }
  return flights;
}

export async function fetchOkadama() {
  const html = await get(PAGE);
  const dep = parseTable(html, "dep_table", "departure");
  const arr = parseTable(html, "arr_table", "arrival");
  if (!dep || !arr) throw new Error("丘珠空港: 出発・到着の表が見つからない");

  const counts = {};
  const flights = [];
  for (const f of [...dep, ...arr]) {
    const g = GROUPS[f.group];
    const c = (counts[f.group] ||= { total: 0, cancelled: 0, delayed: 0, diverted: 0, delayed_30: 0, done_late: 0 });
    c.total++;
    const min = delayMin(f.scheduled, f.estimated);
    let kind = classify(f.remark, /出発済|到着済/.test(f.remark));
    // 備考が空でも、変更時刻が定刻より後なら遅れ
    if (kind === "normal" && min > 0) kind = "delayed";
    if (kind in c) c[kind]++;
    // 出発・到着済みの便は、30分以上遅れたものだけ一覧に残す。状態の判定には使わない（新千歳空港と同じ）
    const doneLate = kind === "done" && min >= 30;
    if (doneLate) c.done_late++;
    if (kind === "cancelled" || kind === "delayed" || kind === "diverted" || doneLate) {
      if (kind === "delayed" && (min == null || min >= 30)) c.delayed_30++;
      flights.push({
        dir: f.dir,
        group: f.group,
        flight: `${g?.code || "---"}${f.number}`,
        airline: g?.airline || "",
        place: f.place,
        scheduled: f.scheduled,
        estimated: f.estimated,
        delay_min: min,
        kind, // cancelled / delayed / diverted（目的地天候不良・引き返しなど）/ done（出発・到着済みで30分以上遅れた便）
      });
    }
  }

  // 便のある系列だけ並べる（FDA は冬は便がない）。便が1件もない日は groups が空になる
  const groups = [...Object.keys(GROUPS), "other"]
    .filter((id) => counts[id])
    .map((id) => {
      const c = counts[id];
      const bad = c.cancelled + c.diverted;
      // 欠航が3割を超えたら「大規模欠航」、欠航・引き返しか30分以上の遅れが1便でもあれば「遅れ・欠航あり」
      const status = c.total && bad / c.total >= 0.3 ? "suspended" : bad + c.delayed_30 > 0 ? "delay" : "normal";
      return { id, name: GROUPS[id]?.name || "そのほか", status, ...c };
    });
  flights.sort((a, b) => a.scheduled.localeCompare(b.scheduled));

  return { source_time: null, url: PAGE, groups, flights, warnings: [] };
}
