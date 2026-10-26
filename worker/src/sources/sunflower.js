// さんふらわあ（商船三井さんふらわあ、大洗〜苫小牧）：トップの「運航状況」欄
//   <h2 class="top-hdg-02">運航状況</h2> <div class="content"> <p><B>本日は通常とおり運航しております。<BR /> … </p> </div>
// 欄の中身は自由記述（グッズの品切れや電話番号の案内も入る）なので、文章は取り込まず状態だけを判定する。
// 平常時は冒頭が「本日は通常運航しております」「本日は通常とおり運航しております」。
// 荒天などのときは冒頭が「【低気圧の影響による海上荒天に伴う運航状況について】 2026.2.28 09：00現在 …」になり、便ごとに欠航・遅れが並ぶ
// （2025〜2026年冬の Wayback Machine の保存で確認）。
import { get } from "../http.js";

const PAGE = "https://www.sunflower.co.jp/";

function judge(text) {
  if (/^本日は通常(?:とおり|通り)?運航/.test(text)) return { status: "normal", label: "通常運航" };
  if (/欠航/.test(text)) return { status: "suspended", label: "欠航あり" };
  if (/遅/.test(text)) return { status: "delay", label: "遅れあり" };
  return { status: "delay", label: "運航のお知らせあり" };
}

export async function fetchSunflower() {
  const html = await get(PAGE);
  const i = html.indexOf('class="top-hdg-02">運航状況');
  if (i < 0) throw new Error("さんふらわあ: 運航状況の欄が見つからない");
  const content = /<div class="content">([\s\S]*?)<\/div>/.exec(html.slice(i))?.[1];
  const text = (content || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[﻿\s]+/g, " ")
    .trim();
  if (!text) throw new Error("さんふらわあ: 運航状況の欄が空");
  // 「2026.2.28 09：00現在」があれば、その時刻を情報の時刻にする（平常時はない）
  const t = /(\d{4})\.(\d{1,2})\.(\d{1,2})\s*(\d{1,2})[：:](\d{2})\s*現在/.exec(text);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    source_time: t ? `${t[1]}-${pad(t[2])}-${pad(t[3])}T${pad(t[4])}:${t[5]}:00+09:00` : null,
    ...judge(text),
    warnings: [],
  };
}
