// 事業者サイトへの取得で共通に使う設定
// User-Agent はブラウザを装わず、プロジェクト名と連絡先（公開サイトの URL）を明記する
export const USER_AGENT =
  "hokkaido-delay/0.1 (+https://realryo1.github.io/hokkaido_delay/; unofficial fan project; 5min interval)";

// 1つの事業者が応答しなくても全体が止まらないよう、取得ごとに上限時間を設ける
const TIMEOUT_MS = 8000;

// 日本時間の ISO 文字列（例 2027-02-06T10:30:00+09:00）
export function jstIso(date = new Date()) {
  const t = new Date(date.getTime() + 9 * 3600 * 1000);
  return `${t.toISOString().slice(0, 19)}+09:00`;
}

// withDate: true で { body, lastModified }（Last-Modified ヘッダーを日本時間の ISO 文字列にしたもの。ないときは null）を返す
export async function get(url, { type = "text", withDate = false } = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: type === "json" ? "application/json" : "text/html" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const text = await res.text();
  // JR北海道の JSON は先頭に BOM が付いている
  const body = type === "json" ? JSON.parse(text.replace(/^﻿/, "")) : text;
  if (!withDate) return body;
  const lm = Date.parse(res.headers.get("Last-Modified"));
  return { body, lastModified: Number.isFinite(lm) ? jstIso(new Date(lm)) : null };
}
