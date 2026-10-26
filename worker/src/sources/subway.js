// 札幌市営地下鉄：交通局トップに差し込まれている運行情報パーツ（HTML）
//   <div class="tc_line">南北線</div><div class="tc_mark status_o">…</div><div class="tc_text">平常運転しています</div>
// status_o が平常。それ以外のクラス名は未確認なので、文言でも判定する。
import { get } from "../http.js";

const URL = "https://operationstatus.city.sapporo.jp/unkojoho/top.html";
const OFFICIAL = "https://operationstatus.city.sapporo.jp/unkojoho/";
const LINES = [
  { id: "nanboku", name: "南北線" },
  { id: "tozai", name: "東西線" },
  { id: "toho", name: "東豊線" },
];

function judge(mark, text) {
  if (/見合|運休|運転を中止/.test(text)) return "suspended";
  if (mark === "status_o" || /平常/.test(text)) return "normal";
  return "delay";
}

export async function fetchSubway() {
  const html = await get(URL);
  const re =
    /class="tc_line">\s*([^<]+?)\s*<\/div>\s*<div class="tc_mark ([^"]*)">[\s\S]*?<div class="tc_text">\s*([^<]*?)\s*<\/div>/g;
  const found = new Map();
  for (const [, line, mark, text] of html.matchAll(re)) found.set(line, { mark: mark.trim(), text });

  const items = LINES.map((l) => {
    const f = found.get(l.name);
    // 文言は「平常運転しています」「遅れが発生しています」程度の短い定型句なので、そのまま表示に使う
    return f
      ? { id: l.id, name: l.name, status: judge(f.mark, f.text), message: f.text, url: OFFICIAL }
      : { id: l.id, name: l.name, status: "unknown", message: null, url: OFFICIAL };
  });
  const unknown = items.filter((i) => i.status === "unknown");
  if (unknown.length === items.length) throw new Error("地下鉄: 運行情報パーツが見つからない");
  return { source_time: null, items, warnings: unknown.map((i) => `地下鉄: ${i.name} が見つからない`) };
}
