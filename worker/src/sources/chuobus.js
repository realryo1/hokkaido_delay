// 北海道中央バス：運休情報の RSS（全路線の一覧 topic=stop_list）。運休のある便・系統だけが item として載る
//   <channel><title>北海道中央バス運休情報</title><link>…/support/stop/?ope=list</link>
//   <item><title>札幌→小樽/Sapporo→Otaru 高速おたる号（北大経由）  運休中 高速道路通行止めのため…</title>
//         <guid>612_0_1_9999_1770011504</guid><pubDate>Mon, 02 Feb 2026 14:51:44 +0900</pubDate></item>
// 題名は「方向/英語 路線名（便）  状態 理由の文章」。取り込むのは方向・系統名・時刻・状態の語だけで、理由の文章は捨てる。
// guid の先頭は系統番号（rsn）と ket。空港連絡バスは題名に「空港連絡バス」、高速おたる号は「高速おたる号」、高速とまこまい号は「高速とまこまい号」が入る。
// 存在しない topic を指定しても、題名が「運休情報」の空のフィードが 200 で返る。運休なしと見分けられないので、チャンネルの題名を確かめる。
// 遅れの情報はない。
import { get } from "../http.js";

const FEED = "https://www.chuo-bus.co.jp/support/stop/?ope=feed&topic=stop_list";
const LIST = "https://www.chuo-bus.co.jp/support/stop/";
const CHANNEL_TITLE = "北海道中央バス運休情報";

// 状態の語 → 状態。運休中は系統ごと（終日など）、それ以外は一部の便・区間
const STATES = { 運休中: "suspended", 一部区間運休中: "delay", 一部便運休中: "delay", 運休: "delay" };
const STATE_RE = new RegExp(`\\s(${Object.keys(STATES).join("|")})(?:\\s|$)`);

// 系統名：空港連絡バスは「空港連絡バス(Airport Liner)<br>札幌都心系統(Sapporo Downtown)」の <br> のあと、
// 高速おたる号は「高速おたる号（円山経由）」、高速とまこまい号は「高速とまこまい号」。英語の併記「(…)」は外す
const noEn = (s) => s.replace(/[（(][\x20-\x7e]+[）)]/g, "").replace(/\s+/g, " ").trim();
const GROUPS = [
  { id: "airport", name: "新千歳空港連絡バス", test: /空港連絡バス/, route: (head) => noEn(head.split(/<br\s*\/?>/i)[1] || "") },
  { id: "otaru", name: "高速おたる号（札幌〜小樽）", test: /高速おたる号/, route: (head) => /高速おたる号(?:（[^）]*）)?/.exec(head)[0] },
  // 苫小牧西港（シルバーフェリー）へ行く便があるので載せる（plan.js でも使う）
  {
    id: "tomakomai",
    name: "高速とまこまい号（札幌〜苫小牧）",
    test: /高速とまこまい号/,
    route: (head) => /高速とまこまい号(?:（[^）]*）)?/.exec(head)[0],
  },
];

const decode = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
// <guid isPermaLink="true"> のように属性が付くものもある
const tag = (xml, name) => decode(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml)?.[1] || "").trim();

export async function fetchChuobus() {
  const xml = await get(FEED);
  const channel = /<channel>([\s\S]*)<\/channel>/.exec(xml)?.[1];
  if (!channel) throw new Error("中央バス: RSS の channel が見つからない");
  const title = tag(channel.split("<item>")[0], "title");
  if (title !== CHANNEL_TITLE) throw new Error(`中央バス: RSS の題名が違う（${title.slice(0, 30)}）`);

  const warnings = [];
  const groups = GROUPS.map((g) => ({ id: g.id, name: g.name, status: "normal", items: [] }));
  for (const [, body] of channel.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const text = tag(body, "title");
    const gi = GROUPS.findIndex((g) => g.test.test(text));
    if (gi < 0) continue;
    const [rsn, ket = "0"] = tag(body, "guid").split("_");
    const m = STATE_RE.exec(text);
    if (!m) warnings.push(`中央バス: 状態の語が読めない（系統 ${rsn}）`);
    // 状態の語より前だけを使う（後ろは理由の文章）
    const head = m ? text.slice(0, m.index) : text;
    const direction = head.includes("→") ? head.split("/")[0].trim() : null; // 例「札幌→小樽」
    groups[gi].items.push({
      id: rsn,
      route: GROUPS[gi].route(head) || null, // 例「高速おたる号（北大経由）」「札幌都心系統」
      direction,
      time: /\d{1,2}:\d{2}/.exec(head)?.[0] || null, // 便ごとの運休のときの発車時刻
      status: m ? STATES[m[1]] : "delay",
      label: m ? m[1] : "運休", // 例「運休中」「一部便運休中」
      url: /^\d+$/.test(rsn) ? `${LIST}?ope=list&rsn=${rsn}&ket=${ket}` : LIST,
    });
  }
  for (const g of groups) g.status = g.items.length ? "delay" : "normal";
  return { source_time: null, groups, warnings };
}
