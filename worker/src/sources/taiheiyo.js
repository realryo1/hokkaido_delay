// 太平洋フェリー（名古屋〜仙台〜苫小牧）：トップの「運航状況」欄
//   <p class="p-infoBlock_title">運航状況</p> <p class="p-infoBlock_text">本日は通常運航いたしております。</p>
// 欄の中身は事業者の文章なので取り込まず、状態だけを判定する（2026-10-29 のトップで確認。荒天時の文言は未確認なので、語から分類する）。
import { get } from "../http.js";

const PAGE = "https://www.taiheiyo-ferry.co.jp/";

function judge(text) {
  if (/欠航|運休|見合わせ/.test(text)) return { status: "suspended", label: "欠航・見合わせあり" };
  if (/遅|条件付/.test(text)) return { status: "delay", label: "遅れあり" };
  if (/^本日は通常運航/.test(text)) return { status: "normal", label: "通常運航" };
  return { status: "delay", label: "運航のお知らせあり" };
}

export async function fetchTaiheiyo() {
  const html = await get(PAGE);
  const m = /<p class="p-infoBlock_title">運航状況<\/p>\s*<p class="p-infoBlock_text">([\s\S]*?)<\/p>/.exec(html);
  if (!m) throw new Error("太平洋フェリー: 運航状況の欄が見つからない");
  const text = m[1].replace(/<[^>]+>/g, " ").replace(/[﻿\s　]+/g, " ").trim();
  if (!text) throw new Error("太平洋フェリー: 運航状況の欄が空");
  return { source_time: null, ...judge(text), warnings: [] };
}
