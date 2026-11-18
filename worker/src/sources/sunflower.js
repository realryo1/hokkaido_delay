// さんふらわあ（商船三井さんふらわあ、大洗〜苫小牧）：トップの「運航状況」欄
//   <h2 class="top-hdg-02">運航状況</h2> <div class="content"> <p><B>本日は通常とおり運航しております。<BR /> … </p> </div>
// 欄の中身は自由記述（グッズの品切れや電話番号の案内も入る）なので、文章は表示せず状態だけを判定する。
// 平常時は冒頭が「本日は通常運航しております」「本日は通常とおり運航しております」（2024〜2025年は「平常通り」「スケジュール通り」もあった）。
// 荒天などのときは冒頭が「【低気圧の影響による海上荒天に伴う運航状況について】 2026.2.28 09：00現在 …」になり、便ごとに欠航・遅れが並ぶ
// （2024〜2026年の Wayback Machine の保存で確認）。
//
// 平常時以外は、欄の中の便を読む。2024〜2026年の保存では、ほとんどが次の形
//   ＜大洗発＞（「＜大洗発 欠航＞」「＜苫小牧発臨時運航＞」もある）
//   11月18日（水） 深夜便01：45発 さんふらわあ かむい 欠航
// 取り込むのは日付・出発港・時刻・便（深夜便・夕方便）・船名だけで、状態は行の語から分類したラベルにする。
// 行の後ろの補足（出港時刻の変更・入港予定の時刻・船舶入替など）と要約は LLM で読む（src/notes.js）。
// 日付か「深夜便」「夕方便」で始まるのに読めない行（「月7日（水）」の書き間違い、日付や時刻のない書き方）は unread に数える。
import { get } from "../http.js";
import { noticeTexts, MAX_TEXT } from "../noticeTexts.js";

const PAGE = "https://www.sunflower.co.jp/";
const PORTS = { 大洗: "苫小牧", 苫小牧: "大洗" }; // 出発港 → 到着港

const pad = (n) => String(n).padStart(2, "0");
// 全角の数字・コロンを半角にし、空白（全角・ノーブレークスペース・BOM）を1つにまとめる
const norm = (s) =>
  s
    .replace(/[０-９：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ \t　\xa0﻿]+/g, " ")
    .trim();

function judge(text) {
  if (/^本日は(?:通常|平常|スケジュール)(?:とおり|通り)?、?運航/.test(text)) return { status: "normal", label: "通常運航" };
  if (/欠航/.test(text)) return { status: "suspended", label: "欠航あり" };
  if (/遅/.test(text)) return { status: "delay", label: "遅れあり" };
  return { status: "delay", label: "運航のお知らせあり" };
}

// 便の行の状態の語を、こちらで決めたラベルに分類する（文言そのものは使わない）
function classify(text) {
  const t = text.replace(/\s/g, "");
  if (/欠航/.test(t)) return { status: "suspended", label: "欠航" };
  if (/臨時/.test(t)) return { status: "normal", label: "臨時便" };
  if (/未定|調査中|確認中/.test(t)) return { status: "delay", label: "状況未定" };
  // 「05:00発（3時間30分遅延） ※大洗着遅延の可能性あり」は遅れ。「遅延の可能性」だけなら遅れの可能性
  const delayed = /遅[延れ]/.test(t.replace(/遅[延れ]の可能性/g, ""));
  const maybe = !delayed && /遅[延れ]の可能性/.test(t);
  const head = /出港済/.test(t) ? "出港済" : /運航予定|出港予定|定刻/.test(t) ? "運航予定" : null;
  if (!head && !delayed && !maybe) return { status: "delay", label: "お知らせを確認" };
  const tail = delayed ? "遅れ" : maybe ? "遅れの可能性" : null;
  return { status: delayed || maybe ? "delay" : "normal", label: [head, tail].filter(Boolean).join("・") };
}

// 11月18日（水） 深夜便01:45発 さんふらわあ かむい 欠航
// 2月27日（金） 夕方便 19:45発さんふらわあ ふらの 欠航（「さんふわらあ」の書き間違いもある）
// 3月3日（日）01:30発 さんふらわあ だいせつ 出港大幅遅延見込み（便の名前がない）
const SAILING = /^(\d{1,2})月(\d{1,2})日\s*（.）\s*(深夜便|夕方便)?\s*(\d{1,2}):(\d{2})発\s*さんふ[らわ]{2}あ\s*(\S+)\s*(.*)$/;

// 欄の中の便を読む。year・month は情報の時刻（なければ取得した日）の年月（12月の案内に1月の便が載るときは翌年にする）
export function parseBox(lines, year, month) {
  const iso = (m, d) => `${m < month - 6 ? year + 1 : m > month + 6 ? year - 1 : year}-${pad(m)}-${pad(d)}`;
  const sailings = [];
  let unread = 0;
  let from = null;
  for (const line of lines) {
    if (/^【/.test(line)) from = null; // 別の案内（グッズ・時刻変更など）
    const p = /^＜(大洗|苫小牧)発/.exec(line.replace(/\s/g, ""));
    if (p) {
      from = p[1];
      continue;
    }
    const s = SAILING.exec(line);
    if (s && from) {
      const [, m, d, kind, hh, mm, ship, rest] = s;
      const item = { date: iso(+m, +d), from, to: PORTS[from], time: `${pad(hh)}:${mm}`, ...(kind ? { kind } : {}), ship: `さんふらわあ ${ship}`, ...classify(rest) };
      if (!sailings.some((x) => x.date === item.date && x.from === item.from && x.time === item.time)) sailings.push(item);
    } else if (/^(\d{0,2}月\d{1,2}日|深夜便|夕方便)/.test(line) && from) {
      unread++;
    }
  }
  return { sailings, unread };
}

export async function fetchSunflower() {
  return parseTop(await get(PAGE));
}

// トップの HTML から状態と便を読む（手元の試験で保存した HTML にも使う）
export function parseTop(html) {
  const i = html.indexOf('class="top-hdg-02">運航状況');
  if (i < 0) throw new Error("さんふらわあ: 運航状況の欄が見つからない");
  const content = /<div class="content">([\s\S]*?)<\/div>/.exec(html.slice(i))?.[1] || "";
  const lines = content
    .replace(/<br\s*\/?>|<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map(norm)
    .filter(Boolean);
  const text = lines.join(" ");
  if (!text) throw new Error("さんふらわあ: 運航状況の欄が空");
  // 「2026.2.28 09：00現在」があれば、その時刻を情報の時刻にする（平常時はない）
  const t = /(\d{4})\.(\d{1,2})\.(\d{1,2})\s*(\d{1,2}):(\d{2})\s*現在/.exec(text);
  const source_time = t ? `${t[1]}-${pad(t[2])}-${pad(t[3])}T${pad(t[4])}:${t[5]}:00+09:00` : null;
  const state = judge(text);

  // 平常時は便を読まず、LLM にも渡さない（グッズや電話番号の案内だけのため）
  noticeTexts.delete("sunflower");
  let sailings = null;
  let unread = 0;
  let posted = null;
  if (state.status !== "normal") {
    const now = new Date(Date.now() + 9 * 3600 * 1000); // 日本時間
    posted = t ? `${t[1]}-${pad(t[2])}-${pad(t[3])}` : now.toISOString().slice(0, 10);
    ({ sailings, unread } = parseBox(lines, +posted.slice(0, 4), +posted.slice(5, 7)));
    noticeTexts.set("sunflower", lines.join("\n").slice(0, MAX_TEXT));
  }
  // 状態は欄の語から分類したもの。欠航・遅れの便からの「大幅欠航」などの判定はページ側（website/js/ferry.js）
  return { source_time, ...state, posted, sailings, unread, warnings: [] };
}
