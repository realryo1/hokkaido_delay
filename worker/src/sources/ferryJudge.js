// フェリーの状態を、お知らせから正規表現で読んだ便から決める（シルバーフェリー・さんふらわあ・新日本海フェリー）
// 数えるのは今日と明日（日本時間）に出る便。数えるのは label が「欠航」の便だけ（定期検査などの「運休」と、LLM が足した便は数えない）
//   どちらかの日で、欠航がその日の便数の半分以上 → 大幅欠航（suspended）
//   欠航が1便以上 → 一部欠航（delay）
//   遅れの便がある → 遅れあり（delay）
//   先の日にだけ欠航がある → 「2/15〜欠航あり」（delay）
//   どれでもない → null（呼んだ側の今までの判定を使う）
// 1日の便数は公式の時刻表から（perDay）。お知らせは港を出る便ごとに書くので、各港の出港を1便と数える

// 日本時間の今日・明日（"2026-11-19"）
function days() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  return [today, tomorrow];
}
const md = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;

export function judgeSailings(sailings, perDay) {
  const list = (sailings || []).filter((s) => s.source !== "llm");
  if (!list.length) return null;
  const [today, tomorrow] = days();
  const near = list.filter((s) => s.date === today || s.date === tomorrow);
  const cancelled = (d) => near.filter((s) => s.date === d && s.label === "欠航").length;
  if ([today, tomorrow].some((d) => cancelled(d) > 0 && cancelled(d) * 2 >= perDay(d))) return { status: "suspended", label: "大幅欠航" };
  if (cancelled(today) + cancelled(tomorrow) > 0) return { status: "delay", label: "一部欠航" };
  if (near.some((s) => s.status === "delay")) return { status: "delay", label: "遅れあり" };
  const later = list.filter((s) => s.date > tomorrow && s.label === "欠航").map((s) => s.date).sort();
  if (later.length) return { status: "delay", label: `${md(later[0])}〜欠航あり` };
  return null;
}

// 曜日（0 = 日曜）。"2026-11-19" は日本時間の日付なので、UTC の正午として曜日を出す
export const weekday = (iso) => new Date(`${iso}T12:00:00Z`).getUTCDay();
