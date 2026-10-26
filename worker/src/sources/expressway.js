// 高速道路（道央道・札樽道）：アイハイウェイ（NEXCO西日本情報テクノロジー運営、情報提供は JARTIC）が地図の描画に使っている JSON
// traffic.json 1本に全国9エリアの規制が入っている。北海道は area01。
// area01.trafficInfo（通行止・チェーン規制・事故など）と area01.otherTrafficInfo（工事の車線規制・速度規制など）に、
// 種類ごとに [{ roadName, info: [{ title（区間）, direction, reason, detail, coordinate }] }] がある。
// 取り込むのは路線・区間・方向・種類・原因（「作業」「事故」などの短い語）だけで、座標は使わない。
import { get } from "../http.js";

const URL = "https://ihighway.jp/datas/json/traffic.json";

// 種類 → 表示名（アイハイウェイの CM_Constant.js の TRAFFIC_LAYER.KINDS と同じ表記）
const KINDS = {
  closed: "通行止",
  ramp: "ランプ閉鎖",
  snowChain: "チェーン規制",
  snowTires: "冬用タイヤ等装着",
  oneLane: "片側交互通行",
  jam: "渋滞",
  accident: "事故・火災",
  broken: "故障車",
  falling: "落下物",
  laneRestriction: "車線規制",
  speed: "速度規制",
  underRegulation: "規制中",
  snowPlow: "除雪作業",
  antifreeze: "凍結防止剤散布",
  underAdjustment: "調整中",
};
// 路線の状態に使う種類（アイハイウェイが「重要な規制」としているもの）。それ以外は一覧に載せるだけ
const MAJOR = ["closed", "ramp", "snowChain", "snowTires", "oneLane", "jam", "accident", "broken", "falling"];

// 来訪者の移動に関わる区間だけを載せる。道央道は函館〜士別剣淵と長いので、区間名（title）に near の語を含むものだけにする
//   苫小牧（フェリー）〜新千歳空港〜札幌JCT
const ROADS = [
  {
    id: "doo",
    name: "道央道（苫小牧〜新千歳空港〜札幌）",
    road: "道央道",
    near: ["苫小牧", "千歳", "恵庭", "島松", "北広島", "輪厚", "札幌南", "大谷地", "札幌JCT"],
  },
  { id: "sasson", name: "札樽道（札幌〜小樽）", road: "札樽道", near: null },
];

export async function fetchExpressway() {
  const { body: data, lastModified } = await get(URL, { type: "json", withDate: true });
  const area = data?.area01;
  if (!area?.trafficInfo || !area?.otherTrafficInfo) throw new Error("高速道路: 北海道エリアの規制情報が見つからない");

  const warnings = [];
  const unknownKinds = new Set();
  const roads = ROADS.map((r) => ({ id: r.id, name: r.name, status: "normal", items: [] }));

  for (const bucket of [area.trafficInfo, area.otherTrafficInfo]) {
    for (const [kind, list] of Object.entries(bucket)) {
      if (!Array.isArray(list)) continue;
      if (!KINDS[kind]) unknownKinds.add(kind);
      for (const entry of list) {
        const i = ROADS.findIndex((r) => r.road === entry.roadName);
        if (i < 0) continue;
        for (const info of entry.info || []) {
          const section = String(info.title || "");
          if (ROADS[i].near && !ROADS[i].near.some((w) => section.includes(w))) continue;
          roads[i].items.push({
            kind,
            label: KINDS[kind] || kind,
            major: MAJOR.includes(kind),
            section,
            direction: info.direction || null, // 例「上り：函館方面」
            reason: info.reason || null, // 例「作業」「事故」「雪」
            detail: info.detail || null, // 例「追越車線規制」
          });
        }
      }
    }
  }

  for (const r of roads) {
    // 通行止を先頭に、重要な規制、そのほかの順に並べる
    r.items.sort((a, b) => (b.kind === "closed") - (a.kind === "closed") || b.major - a.major);
    r.status = r.items.some((x) => x.kind === "closed") ? "suspended" : r.items.some((x) => x.major) ? "delay" : "normal";
  }
  // 知らない種類が増えたら、表示名を足すために知らせる（キーのまま表示はされる）
  if (unknownKinds.size) warnings.push(`高速道路: 未知の規制の種類 ${[...unknownKinds].join(", ")}`);

  return { source_time: lastModified, url: "https://ihighway.jp/", roads, warnings };
}
