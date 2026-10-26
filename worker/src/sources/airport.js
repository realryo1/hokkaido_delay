// 新千歳空港（国内線）：北海道エアポート公式 FIS が画面描画に使っている JSON
// 当日の出発（DA: "D"）・到着（DA: "A"）全便が1本に入っている。
// Airline[0] が実際の運航会社（以降はコードシェア）。備考は RemarkID で分類する（公式 FIS の main.js と同じ対応表）。
import { get } from "../http.js";

const URL = "https://www.hokkaido-airports.com/api/v1/new-chitose/static/fis/domestic/today.json";
const OFFICIAL = "https://www.hokkaido-airports.com/ja/new-chitose/airport/fis/";

const REMARK = {
  D: {
    cancelled: ["21", "48", "70", "71", "72", "73", "30", "20", "47", "66", "67", "68", "69"],
    delayed: ["18", "43", "62", "63", "64", "65", "16", "42", "76", "58", "59", "60", "61", "51", "52", "53", "54", "55", "56"],
    done: ["14"],
  },
  A: {
    cancelled: ["21", "48", "70", "71", "72", "73", "20", "47", "66", "67", "68", "69", "157", "158", "159", "160"],
    delayed: ["109", "134", "153", "154", "155", "156", "107", "133", "149", "150", "151", "152"],
    diverted: ["117", "141", "118", "135", "115", "140"],
    done: ["101", "116", "104", "106"],
  },
};

// 運航会社（3レターコード）→ 系列
const GROUPS = [
  { id: "ana", name: "ANA系（ANA・AIRDO・IBEX ほか）", codes: ["ANA", "ADO", "IBX", "AKX", "SNJ"] },
  { id: "jal", name: "JAL系（JAL・J-AIR・FDA ほか）", codes: ["JAL", "JLJ", "FDA", "NTH", "JAC"] },
  { id: "other", name: "スカイマーク・LCC ほか", codes: null },
];

function classify(dir, a) {
  const r = REMARK[dir];
  const id = a.RemarkID;
  if (r.cancelled.includes(id) || /欠航/.test(a.Remark)) return "cancelled";
  if (r.diverted?.includes(id) || /引き?返|目的地変更|ダイバート/.test(a.Remark)) return "diverted";
  if (r.delayed.includes(id) || /遅れ|遅延/.test(a.Remark)) return "delayed";
  if (r.done.includes(id)) return "done";
  return "normal";
}

// 定刻と変更時刻の差（分）。日付をまたぐ場合も考慮する
function delayMin(f) {
  if (!f.ET_AT || !f.ST) return null;
  const t = (ymd, hm) => Date.parse(`${ymd}T${hm}:00+09:00`);
  const d = Math.round((t(f.EYMD_AYMD || f.SYMD, f.ET_AT) - t(f.SYMD, f.ST)) / 60000);
  return Number.isFinite(d) ? d : null;
}

export async function fetchAirport() {
  const data = await get(URL, { type: "json" });
  if (data.status !== "success" || !Array.isArray(data.items)) throw new Error("空港: 想定外の形式");

  const counts = Object.fromEntries(
    GROUPS.map((g) => [g.id, { total: 0, cancelled: 0, delayed: 0, diverted: 0, delayed_30: 0, done_late: 0 }])
  );
  const flights = [];

  for (const f of data.items) {
    const dir = f.DA === "A" ? "A" : "D";
    const op = f.Airline?.[0];
    if (!op) continue;
    const group = (GROUPS.find((g) => g.codes?.includes(op.Airline_3Cd)) || GROUPS[2]).id;
    const kind = classify(dir, op);
    const c = counts[group];
    c.total++;
    if (kind in c) c[kind]++;
    const min = delayMin(f);
    // 出発・到着済みの便は、30分以上遅れたものだけ一覧に残す（平常の日でも15分以上の遅れは数十便あるため）。状態の判定には使わない
    const doneLate = kind === "done" && min >= 30;
    if (doneLate) c.done_late++;
    if (kind === "cancelled" || kind === "delayed" || kind === "diverted" || doneLate) {
      if (kind === "delayed" && (min == null || min >= 30)) c.delayed_30++;
      flights.push({
        dir: dir === "D" ? "departure" : "arrival",
        group,
        flight: op.Flight,
        airline: op.AirlineName,
        place: op.AreaName,
        scheduled: f.ST,
        estimated: f.ET_AT || null,
        delay_min: min,
        kind, // cancelled / delayed / diverted / done（出発・到着済みで30分以上遅れた便）
      });
    }
  }

  // today.json には当日の全便（出発・到着済みを含む）が入るので、0便なら形式が変わったとみなす
  if (!GROUPS.some((g) => counts[g.id].total)) throw new Error("空港: 便が1件も読めない");

  const groups = GROUPS.map((g) => {
    const c = counts[g.id];
    const bad = c.cancelled + c.diverted;
    // 欠航が3割を超えたら「大規模欠航」、欠航・引き返しか30分以上の遅れが1便でもあれば「遅れ・欠航あり」
    const status = c.total && bad / c.total >= 0.3 ? "suspended" : bad + c.delayed_30 > 0 ? "delay" : "normal";
    return { id: g.id, name: g.name, status, ...c };
  });
  flights.sort((a, b) => a.scheduled.localeCompare(b.scheduled));

  return { source_time: data.updated || null, url: OFFICIAL, groups, flights };
}
