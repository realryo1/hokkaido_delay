// 新日本海フェリー（舞鶴・敦賀・新潟・秋田〜小樽・苫小牧東）：トップのヘッダーの「運航状況」お知らせ
//   <div class="switchbox …"><input type="checkbox" id="header_info_isopen" /><label for="header_info_isopen">
//     <span class="topnews-category attention">運航状況</span><a href="https://www.snf.jp/snfinfo0206/" >2026.2.7  <span class="topnews-title">…</span></a> …
// 運航に影響があるときだけお知らせが並び、平常時は label の中が空になる（2025〜2026年冬の Wayback Machine の保存で確認）。
// お知らせの題名は事業者の文章なので表示せず、件数・日付・リンクだけを扱う。
//
// お知らせがあるときだけ、リンク先（自社サイトのものだけ）を取りに行き、欠航・遅れの便を読む。本文は手書きだが、2024〜2026年の保存（約30件）では
//   欠航                                      ← 見出し（状態）
//   ◆ 新潟 ～ 小樽                            ← 航路の小見出し（あってもなくてもよい。状態は引き継ぐ）
//   ・1月9日（金）苫小牧東港23:30発→敦賀行     ← 1行が1便
// の形がほとんど。正規表現で読むのは日付・出発港・時刻・行き先（経由地）だけで、状態は見出しの語から分類したラベルにする（行の後ろの補足は LLM で読む。src/notes.js）。
// 欠航・遅れ以外の見出し（臨時便運航・代替便のご案内・運航船舶変更・出発港変更・通常運航など）の下の便と、振替先（⇒）の行は読まない。
// 日付で始まるか行頭が「・」「●」で「発」を含むのに読めない行（「8月30日（日）小樽23:30発→舞鶴行　欠航」のような書き方）は unread に数え、
// ページでは「お知らせで確認」と出す。
import { get } from "../http.js";
import { noticeTexts, MAX_TEXT } from "../noticeTexts.js";

const PAGE = "https://www.snf.jp/";
const LIST = "https://www.snf.jp/info-list/?info_group=operation";
const MAX_NOTICES = 3; // 1回に取りに行くお知らせの数の上限

const pad = (n) => String(n).padStart(2, "0");
// 全角の数字・コロン・かっこを半角／全角にそろえ、空白を1つにまとめる
const norm = (s) =>
  s
    .replace(/[０-９：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .replace(/[ \t　\xa0]+/g, " ")
    .trim();
// 「苫小牧東港」→「苫小牧東」、「敦賀港」→「敦賀」
const port = (s) => s.trim().replace(/港$/, "");

// 見出しの語から状態を決める（欠航・遅れ以外は null で、その下の便は読まない）
function classify(heads) {
  const t = heads.join(" ");
  if (/欠航/.test(t)) return { status: "suspended", label: "欠航" };
  if (/遅れ|遅延/.test(t)) return { status: "delay", label: /可能性|見込/.test(t) ? "遅れの可能性" : "遅れ" };
  return null;
}

// ・1月9日（金）苫小牧東港23:30発→敦賀行（※…）
// ・2月7日（土）苫小牧東港19:30発→秋田・新潟経由敦賀港行
// ・12月20日（金）新潟港22:30発→秋田港・苫小牧東港行
const SAILING = /^[・●]\s*(\d{1,2})月(\d{1,2})日\s*（.）\s*([^\s\d・]+?)\s*(\d{1,2}):(\d{2})\s*発\s*→\s*([^（(]+?)行/;
const HEAD_SKIP = /^[・⇒◆【※（(]|[。：:]$/;

// お知らせのページから欠航・遅れの便を読む。posted はお知らせの日付（"2026-01-09"。年を決めるのに使う）
export function parseNotice(html, posted) {
  const start = html.indexOf('class="entry-content');
  if (start < 0) return { time: null, sailings: [], unread: 0, text: "" };
  let end = html.indexOf("</article>", start);
  if (end < 0) end = start + 30000;
  const lines = html
    .slice(start, end)
    .replace(/^[^>]*>/, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&#8594;|&rarr;/g, "→")
    .split("\n")
    .map(norm)
    .filter(Boolean);

  const year = posted ? +posted.slice(0, 4) : new Date().getFullYear();
  const month = posted ? +posted.slice(5, 7) : 1;
  // 12月のお知らせに1月の便、1月のお知らせに12月の便が載ることがある
  const iso = (m, d) => `${m < month - 6 ? year + 1 : m > month + 6 ? year - 1 : year}-${pad(m)}-${pad(d)}`;

  // 「（1/9 10:00現在）」「（8/7 16:00時点）」を情報の時刻にする
  const t = /（(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2}) ?(現在|時点)）/.exec(lines.join("\n"));
  const time = t ? `${iso(+t[1], +t[2])}T${pad(t[3])}:${t[4]}:00+09:00` : null;

  const sailings = [];
  let unread = 0;
  let heads = []; // 直前の便の行より後に出てきた見出し（津波のときのように重なることがある）
  let state = null;
  let afterSailing = false;
  // 本文の枠にはサイドバーの記事一覧も入っているので、投稿日の行（2026/1/9）より後だけを読む
  const from = lines.findIndex((l) => /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(l));
  const body = []; // LLM に渡す本文
  for (const line of lines.slice(from + 1)) {
    if (/^【[^】]*(手続|お願い|取消|問い?合わ?せ|予約)/.test(line)) break; // 【変更・取消の手続き】【お客様へお願い】以降は便の案内ではない
    if (/[ぁ-んァ-ヶ一-龠]/.test(line)) body.push(line); // 英語の併記は除く
    const bullet = /^[・●]/.test(line) && /\d月|発/.test(line); // 「●欠航」は見出し
    const dated = /^\d{1,2}月\d{1,2}日/.test(line);
    if (bullet || dated) {
      const s = bullet && SAILING.exec(line);
      if (s) {
        afterSailing = true;
        if (!state) continue;
        const [, m, d, from, hh, mm, dest] = s;
        const stops = dest.replace(/経由/, "・").split("・").map(port).filter(Boolean);
        const item = { date: iso(+m, +d), from: port(from), to: stops.pop(), via: stops, time: `${pad(hh)}:${mm}`, ...state };
        if (!sailings.some((x) => x.date === item.date && x.from === item.from && x.time === item.time && x.to === item.to)) sailings.push(item);
      } else if (/発/.test(line) && (dated || state)) {
        unread++;
      }
      continue;
    }
    if (/^◆/.test(line) || HEAD_SKIP.test(line) || line.length > 25 || !/[ぁ-んァ-ヶ一-龠]/.test(line)) continue;
    if (afterSailing) {
      heads = [];
      afterSailing = false;
    }
    heads.push(line.replace(/^●\s*/, ""));
    state = classify(heads);
  }
  return { time, sailings, unread, text: body.join("\n").slice(0, MAX_TEXT) };
}

export async function fetchSnf() {
  const html = await get(PAGE);
  const i = html.indexOf('id="header_info_isopen"');
  if (i < 0) throw new Error("新日本海フェリー: ヘッダーのお知らせ欄が見つからない");
  const box = html.slice(i, html.indexOf("<!--//switchbox-->", i));
  const notices = [];
  const re = /<span class="topnews-category[^"]*">運航状況<\/span>\s*<a href="([^"]+)"\s*>\s*(\d{4})\.(\d{1,2})\.(\d{1,2})/g;
  for (const [, url, y, mo, d] of box.matchAll(re)) {
    if (notices.some((n) => n.url === url)) continue;
    notices.push({ date: `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`, url });
  }
  // 「運航状況」の印があるのにお知らせが読めないときは、構造が変わった疑い
  const warnings = notices.length || !/>運航状況</.test(box) ? [] : ["新日本海フェリー: 運航状況のお知らせが読めない"];

  // お知らせの本文（自社サイトのものだけ）。取れなくてもトップの状態は出す（sailings: null は「便ごとの状況は読めていない」）
  for (const k of noticeTexts.keys()) if (k.startsWith("snf ")) noticeTexts.delete(k);
  for (const n of notices.slice(0, MAX_NOTICES)) {
    n.time = null;
    n.sailings = null;
    n.unread = 0;
    if (!/^https?:\/\/www\.snf\.jp\/[\w./-]+$/.test(n.url)) continue;
    try {
      const { text, ...parsed } = parseNotice(await get(n.url.replace(/^http:/, "https:")), n.date);
      Object.assign(n, parsed);
      if (text) noticeTexts.set(`snf ${n.url}`, text);
    } catch {
      n.sailings = null;
    }
  }
  return { source_time: null, status: notices.length ? "delay" : "normal", list_url: LIST, notices, warnings };
}
