// フェリーの状態を、Worker が返した便（お知らせから正規表現で読んだもの）からページ側で決める（シルバーフェリー・さんふらわあ・新日本海フェリー）
// Worker は事業者の状態・便・Haiku の要約だけを返し、こちらの判定はしない。色（status）と言葉（text）は別に返す
//   数えるのは今日と明日（日本時間）に出る便の「欠航」（定期検査などの「運休」と、Haiku が足した便は数えない）
//   欠航があれば色は赤（suspended）。言葉は、どちらかの日で欠航がその日の便数の半分以上なら「大幅欠航」、それ以外は「一部欠航」
//   欠航はなく遅れの便がある → 黄（delay）「遅れあり」
//   先の日にだけ欠航がある → 黄（delay）「2/15〜欠航あり」
//   どれでもない・便を読めていない → null（事業者の状態のまま）
import { md } from "./util.js";

// 1日の便数。お知らせは港を出る便ごとに書くので、各港の出港を1便と数える。時刻表が変わったら直す
//   シルバーフェリー：八戸発4・苫小牧発4（公式「航路・時刻」）。定期検査で「運休」の便はその日の便数から除く
//   さんふらわあ：大洗発・苫小牧発の深夜便・夕方便（公式「運航ダイヤ」2026-11-19 確認）
//   新日本海フェリー：曜日（0 = 日曜）ごと。公式「時刻表・運航スケジュール」（2026-11-19 確認）から数えた。運航日が変則になることがある（配船表）ので目安
//     毎日：舞鶴23:50・小樽23:30・敦賀23:55・苫小牧東23:30。小樽16:45 は月〜土、新潟12:00 は火〜日
//     通常ダイヤの日本海側（敦賀・新潟・秋田経由）：敦賀18:30 火木日、新潟22:30 月水金、秋田06:15 火木土、苫小牧東19:30 火木土、秋田08:35 水金日、新潟17:30 水金日
//     2027-01-12 出港便からのドック期間ダイヤ：敦賀09:30 月、新潟22:30 月〜土、秋田06:15 火〜日、苫小牧東19:30 月〜土、秋田08:35 火〜日、新潟16:30 日（終わりの日は時刻表に書かれていない）
const SNF_PER_DAY = [8, 6, 9, 9, 9, 9, 8];
const SNF_PER_DAY_DOCK = [8, 8, 10, 10, 10, 10, 10];
const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
const PER_DAY = {
  silverferry: (d, list) => 8 - list.filter((s) => s.date === d && s.label === "運休").length,
  sunflower: () => 4,
  snf: (d) => (d >= "2027-01-12" ? SNF_PER_DAY_DOCK : SNF_PER_DAY)[weekday(d)],
};

// 日本時間の今日・明日（"2026-11-19"）
// サンプル表示（?sample）のときは、サンプルの更新時刻を「今」にする（main.js が setNow で渡す）
let fixedNow = null;
export const setNow = (iso) => (fixedNow = iso ? Date.parse(iso) : null);
function days() {
  const iso = (t) => new Date(t).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const now = fixedNow ?? Date.now();
  return [iso(now), iso(now + 24 * 3600 * 1000)];
}

export function judgeFerry(id, svc) {
  if (!PER_DAY[id] || !svc?.ok) return null;
  const all = id === "snf" ? (svc.notices || []).flatMap((n) => n.sailings || []) : svc.sailings || [];
  const list = all.filter((s) => s.source !== "llm");
  if (!list.length) return null;
  const [today, tomorrow] = days();
  const near = list.filter((s) => s.date === today || s.date === tomorrow);
  const cancelled = (d) => near.filter((s) => s.date === d && s.label === "欠航").length;
  if (cancelled(today) + cancelled(tomorrow) > 0) {
    const big = [today, tomorrow].some((d) => cancelled(d) > 0 && cancelled(d) * 2 >= PER_DAY[id](d, list));
    return { status: "suspended", text: big ? "大幅欠航" : "一部欠航" };
  }
  if (near.some((s) => s.status === "delay")) return { status: "delay", text: "遅れあり" };
  const later = list.filter((s) => s.date > tomorrow && s.label === "欠航").map((s) => s.date).sort();
  if (later.length) return { status: "delay", text: `${md(later[0])}〜欠航あり` };
  return null;
}
