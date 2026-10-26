// シルバーフェリー（川崎近海汽船、八戸〜苫小牧）：トップの「運航情報」欄
//   <div class="status normal"> … <h3> 運航情報 </h3> <p> 通常運航しています </p></a> </div>
//   <div class="status delay"> … <a href="http://www.silverferry.jp/whatsnew/post/20251209.html">欠航または遅延便があります</a> </div>
// クラスは normal と delay の2種類（2025〜2026年冬の Wayback Machine の保存で確認）。文言は定型の短い語なので、そのまま表示に使う。
//
// delay のときだけ、リンク先のお知らせを取りに行き、便ごとの状況を読む。お知らせの本文は手書きだが、2024〜2026年の保存では次の形でそろっている
//   【3月16日（日）】 ＜八戸発＞ 08:45発便 シルバープリンセス 運航予定 … ＜苫小牧発＞ 21:15発便 シルバープリンセス 欠 航
// 取り込むのは日付・出発港・時刻・船名だけで、状態の文言（「八戸港入港遅延見込み」など）は語から分類したラベルにする。
// 平常時は便ごとの情報がない（定期検査の運休や代船の期間もトップは「通常運航しています」のまま）ので、便ごとには分けない。
import { get } from "../http.js";

const PAGE = "https://www.silverferry.jp/";
const CLASSES = { normal: "normal", delay: "delay" };
const PORTS = { 八戸: "苫小牧", 苫小牧: "八戸" }; // 出発港 → 到着港

// 全角の数字・記号を半角にし、空白（全角・ノーブレークスペース）を1つにまとめる
const norm = (s) =>
  s
    .replace(/[０-９：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[ \t　\xa0]+/g, " ")
    .trim();
const pad = (n) => String(n).padStart(2, "0");

// 状態の文言を、こちらで決めたラベルに分類する（文言そのものは使わない）
function classify(text) {
  const t = text.replace(/\s/g, "");
  if (/欠航/.test(t)) return { status: "suspended", label: "欠航" };
  if (/運休/.test(t)) return { status: "suspended", label: "運休" };
  const delayed = /遅延|遅れ/.test(t);
  const head = /出港済/.test(t) ? "出港済" : /運航予定|定刻/.test(t) ? "運航予定" : null;
  if (!head && !delayed) return { status: "delay", label: "お知らせを確認" };
  return { status: delayed ? "delay" : "normal", label: [head, delayed ? "遅れ見込み" : null].filter(Boolean).join("・") };
}

// お知らせのページから便ごとの状況を読む。year はお知らせの日付の年（12月のお知らせに1月の便が載るときは翌年にする）
export function parseNotice(html) {
  const start = html.indexOf("postTitle");
  if (start < 0) return { sailings: [], time: null };
  const end = html.indexOf("lowerBlock", start);
  const text = html
    .slice(start, end > 0 ? end : undefined)
    .replace(/<br\s*\/?>|<\/p>|<\/h2>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  const lines = text.split("\n").map(norm).filter(Boolean);

  const posted = /(\d{4})\.(\d{1,2})\.(\d{1,2})/.exec(text);
  const year = posted ? +posted[1] : new Date().getFullYear();
  const postedMonth = posted ? +posted[2] : 1;
  const iso = (m, d) => `${m < postedMonth - 6 ? year + 1 : year}-${pad(m)}-${pad(d)}`;

  // 題名の「（3月15日16:00現在）」を情報の時刻にする
  const t = /(\d{1,2})月(\d{1,2})日\s*(\d{1,2}):(\d{2})\s*現在/.exec(lines.slice(0, 3).join(" "));
  const time = t ? `${iso(+t[1], +t[2])}T${pad(t[3])}:${t[4]}:00+09:00` : null;

  const sailings = [];
  let date = null;
  let from = null;
  for (const line of lines) {
    const d = /^【(\d{1,2})月(\d{1,2})日/.exec(line);
    if (d) {
      date = iso(+d[1], +d[2]);
      from = null;
      continue;
    }
    const p = /^＜(八戸|苫小牧)発＞/.exec(line);
    if (p) {
      from = p[1];
      continue;
    }
    const s = /^(\d{1,2}):(\d{2})\s*発便\s*(\S+)\s*(.*)$/.exec(line);
    if (s && date && from) {
      sailings.push({ date, from, to: PORTS[from], time: `${pad(s[1])}:${s[2]}`, ship: s[3], ...classify(s[4]) });
    }
  }
  return { sailings, time };
}

export async function fetchSilverferry() {
  const html = await get(PAGE);
  const m = /<div class="status ([^"]*)">([\s\S]*?)<\/div>/.exec(html);
  if (!m) throw new Error("シルバーフェリー: 運航情報の欄が見つからない");
  const cls = m[1].trim();
  // 見出し「運航情報」を除いた残りが状態の文言
  const message = m[2].replace(/<h3>[\s\S]*?<\/h3>/, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  const href = [...m[2].matchAll(/href="(https?:\/\/[^"]+)"/g)].map((x) => x[1])[0];
  // 欠航・遅延のときに出るお知らせへのリンク（自社サイトのものだけ）
  const notice_url = href && /^https?:\/\/www\.silverferry\.jp\//.test(href) ? href.replace(/^http:/, "https:") : null;
  const warnings = [];
  if (!CLASSES[cls]) warnings.push(`シルバーフェリー: 未知の状態のクラス ${cls}`);
  const status = CLASSES[cls] || (/通常運航/.test(message) ? "normal" : "delay");

  // お知らせが取れなくても、トップの状態は出す（sailings: null は「便ごとの状況は読めていない」）
  let sailings = null;
  let source_time = null;
  if (status !== "normal" && notice_url) {
    try {
      const n = parseNotice(await get(notice_url));
      sailings = n.sailings;
      source_time = n.time;
    } catch {
      sailings = null;
    }
  }
  return { source_time, status, message: message || null, notice_url, sailings, warnings };
}
