// 全事業者から並行して取得し、1本の JSON にまとめる
// 取得に失敗した事業者は前回成功時のデータを残したまま ok: false にし、meta.source_errors に記録する（段階的縮退）
// 取得はできたが一部が読めない（事業者側の構造変更の疑い）ときは、各 sources が warnings を返し、meta.source_warnings に記録する
// fail_count は連続で失敗した回数（成功したら0に戻る）。/health の判定に使う
import { fetchJr } from "./sources/jr.js";
import { fetchSubway } from "./sources/subway.js";
import { fetchAirport } from "./sources/airport.js";
import { fetchExpressway } from "./sources/expressway.js";
import { fetchChuobus } from "./sources/chuobus.js";
import { fetchHokto } from "./sources/hokto.js";
import { fetchSilverferry } from "./sources/silverferry.js";
import { fetchSunflower } from "./sources/sunflower.js";
import { fetchSnf } from "./sources/snf.js";
import { jstIso } from "./http.js";

export { jstIso };

export const SCHEMA_VERSION = 1;

const SOURCES = [
  { id: "jr", name: "JR北海道", url: "https://www3.jrhokkaido.co.jp/webunkou/", run: fetchJr },
  { id: "subway", name: "札幌市営地下鉄", url: "https://operationstatus.city.sapporo.jp/unkojoho/", run: fetchSubway },
  { id: "airport", name: "新千歳空港（国内線）", url: "https://www.hokkaido-airports.com/ja/new-chitose/airport/fis/", run: fetchAirport },
  { id: "expressway", name: "高速道路（アイハイウェイ）", url: "https://ihighway.jp/", run: fetchExpressway },
  { id: "chuobus", name: "北海道中央バス", url: "https://www.chuo-bus.co.jp/support/stop/", run: fetchChuobus },
  { id: "hokto", name: "北都交通", url: "https://www.hokto.co.jp/", run: fetchHokto },
  { id: "silverferry", name: "シルバーフェリー（八戸〜苫小牧）", url: "https://www.silverferry.jp/", run: fetchSilverferry },
  { id: "sunflower", name: "さんふらわあ（大洗〜苫小牧）", url: "https://www.sunflower.co.jp/", run: fetchSunflower },
  { id: "snf", name: "新日本海フェリー（舞鶴・敦賀・新潟・秋田〜小樽・苫小牧東）", url: "https://www.snf.jp/", run: fetchSnf },
];

export async function collect(prev = null) {
  const now = jstIso();
  const results = await Promise.allSettled(SOURCES.map((s) => s.run()));
  const services = {};
  const errors = [];
  const warnings = [];

  SOURCES.forEach((s, i) => {
    const r = results[i];
    const base = { name: s.name, url: s.url };
    if (r.status === "fulfilled") {
      const { warnings: w = [], ...value } = r.value;
      for (const message of w) warnings.push({ id: s.id, message });
      services[s.id] = { ...base, ok: true, fetched_at: now, last_success_at: now, fail_count: 0, ...value };
      return;
    }
    errors.push({ id: s.id, message: String(r.reason?.message || r.reason).slice(0, 200) });
    const old = prev?.services?.[s.id];
    const fail_count = (old?.fail_count || 0) + 1;
    services[s.id] = old
      ? { ...old, ...base, ok: false, fetched_at: now, fail_count }
      : { ...base, ok: false, fetched_at: now, last_success_at: null, fail_count };
  });

  return {
    version: SCHEMA_VERSION,
    updated_at: now,
    services,
    meta: { source_errors: errors, source_warnings: warnings, fallback_active: errors.length > 0 },
  };
}
