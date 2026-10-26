// 北都交通：トップページの「運行情報」欄。空港連絡バスの系統ごとに、アイコンと短い定型の状態がある
//   <div class="operation-status"><div class="operation-status__route-name"> <span class="name"><a href="/oyachi-chitose/">大谷地線</a></span>
//   <span class="about">地下鉄大谷地駅 ⇔ 新千歳空港</span></div> … ico-status01.svg … <div class="operation-status__status"> 平常運行</div></div>
// アイコンは 01：平常運行、02：一部区間運休、03：全便運休（2025〜2026年冬の Wayback Machine の保存で確認）。
// 状態の文言は定型の短い語なので、そのまま表示に使う。都市間高速バスの欄（intercity-area）は使わない。
import { get } from "../http.js";

const PAGE = "https://www.hokto.co.jp/";
const ICON = { "01": "normal", "02": "delay", "03": "suspended" };

const text = (s) => (s || "").replace(/<[^>]+>/g, "").trim();

function judge(icon, label) {
  if (ICON[icon]) return ICON[icon];
  if (/全便運休|見合|運行中止/.test(label)) return "suspended";
  if (/平常/.test(label)) return "normal";
  return "delay";
}

export async function fetchHokto() {
  const html = await get(PAGE);
  const start = html.indexOf('class="airport-area');
  if (start < 0) throw new Error("北都交通: 空港連絡バスの運行情報欄が見つからない");
  const end = html.indexOf('class="intercity-area', start);
  const block = html.slice(start, end > 0 ? end : html.indexOf("</section>", start));

  const warnings = [];
  const items = block
    .split('<div class="operation-status">')
    .slice(1)
    .map((c) => {
      const name = text(/<span class="name">([\s\S]*?)<\/span>/.exec(c)?.[1]);
      const path = /<span class="name">[\s\S]*?href="([^"]+)"/.exec(c)?.[1];
      const icon = /ico-status(\d+)\.svg/.exec(c)?.[1];
      const label = text(/class="operation-status__status">([\s\S]*?)<\/div>/.exec(c)?.[1]);
      if (!name || !label) return null;
      if (!ICON[icon]) warnings.push(`北都交通: ${name} のアイコン（${icon || "なし"}）が未知`);
      return {
        id: path?.replace(/\//g, "") || name,
        name,
        about: text(/<span class="about">([\s\S]*?)<\/span>/.exec(c)?.[1]) || null, // 例「地下鉄大谷地駅 ⇔ 新千歳空港」
        status: judge(icon, label),
        label, // 例「平常運行」「一部区間運休」「全便運休」
        url: path ? new URL(path, PAGE).href : PAGE,
      };
    })
    .filter(Boolean);
  if (!items.length) throw new Error("北都交通: 空港連絡バスの系統が1つも読めない");
  return { source_time: null, items, warnings };
}
