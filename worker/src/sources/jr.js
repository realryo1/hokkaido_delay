// JR北海道：運行情報サイト（webunkou）が画面描画に使っている JSON
// area_01.json（札幌近郊エリア）1本に、全エリア・全線区の「本日／明日」の状態が入っている。
// 状態は 0：運休・遅延に関する情報なし、1：運休・30分以上の遅延・運転見合わせが発生、2：サービス時間外（深夜）。
// 遅れと運休の区別はない（値の意味は webunkou の js/common_area_operation.js と同じ）。
import { get } from "../http.js";

const BASE = "https://www3.jrhokkaido.co.jp/webunkou/";

// 来訪者の移動に関わる線区だけを載せる。key は senkuStatus / areaStatus のキー、id は webunkou の線区番号
const LINES = [
  { id: "airport", name: "快速エアポート", key: "airport", from: "senkuStatus", senku: "02" },
  { id: "hakochise", name: "函館線・千歳線（札幌近郊）", key: "hakochise", from: "senkuStatus", senku: "03" },
  { id: "gakuen", name: "学園都市線", key: "gakuen", from: "senkuStatus", senku: "04" },
  { id: "express", name: "特急列車（北斗・カムイ など）", key: "express", from: "senkuStatus", senku: "01" },
  { id: "shinkansen", name: "北海道新幹線", key: "shin", from: "areaStatus", senku: "24" },
];

const toStatus = (v) => ({ 0: "normal", 1: "delay", 2: "offhours" })[v] || "unknown";

export async function fetchJr() {
  const data = await get(`${BASE}json/area/area_01.json`, { type: "json" });
  if (!data.today || !data.tomorrow) throw new Error("JR: 想定外の形式");

  const items = LINES.map((l) => ({
    id: l.id,
    name: l.name,
    status: toStatus(data.today[l.from]?.[l.key]),
    tomorrow: toStatus(data.tomorrow[l.from]?.[l.key]),
    url: `${BASE}senku.html?id=${l.senku}`,
  }));
  // キー名が変わると unknown になる。全部なら失敗扱い（前回のデータを残す）、一部なら警告だけ出す
  const unknown = items.filter((i) => i.status === "unknown" || i.tomorrow === "unknown");
  if (unknown.length === items.length) throw new Error("JR: 線区の状態が1つも読めない");
  return {
    source_time: data.time || null, // 例「2026年10月25日 19時56分現在」
    items,
    warnings: unknown.map((i) => `JR: ${i.name} の状態が読めない`),
  };
}
