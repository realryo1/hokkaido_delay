// 新日本海フェリー（舞鶴・敦賀・新潟・秋田〜小樽・苫小牧東）：トップのヘッダーの「運航状況」お知らせ
//   <div class="switchbox …"><input type="checkbox" id="header_info_isopen" /><label for="header_info_isopen">
//     <span class="topnews-category attention">運航状況</span><a href="https://www.snf.jp/snfinfo0206/" >2026.2.7  <span class="topnews-title">…</span></a> …
// 運航に影響があるときだけお知らせが並び、平常時は label の中が空になる（2025〜2026年冬の Wayback Machine の保存で確認）。
// お知らせの題名は事業者の文章なので取り込まず、件数・日付・リンクだけを扱う。欠航か遅れかはここからは分からない。
import { get } from "../http.js";

const PAGE = "https://www.snf.jp/";
const LIST = "https://www.snf.jp/info-list/?info_group=operation";

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
  return { source_time: null, status: notices.length ? "delay" : "normal", list_url: LIST, notices, warnings };
}
