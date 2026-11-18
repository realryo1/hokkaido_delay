// 行き先ごとのまとめ（#summary の中身）。各カードのデータから、行き先ごとに「使える手段があるか」をまとめ、縦の路線図に描く
import { esc, badge, mark } from "./util.js";
import { ROUTEMAP } from "./routemap.js";

// 手段どうしは代わりになるので、すべて平常／一部に乱れ（平常の手段もある）／すべてに乱れ の3段階にする。集計はページ側だけで行う（Worker は変えていない）
const worst = (list) =>
  ["suspended", "delay", "normal"].find((st) => list.includes(st)) || (list.includes("offhours") ? "offhours" : "unknown");
// 手段1つ：id はカードへのリンク先、pick は事業者のデータ → 状態、label は状態 → 表示（なければ共通の表記）、
// line は路線図の線の色（delay.css の .dl-track--{line}。なければ事業者の色）。路線図での置き方は routemap.js に名前で書く
const means = (name, id, svcId, pick, label = {}, line = svcId) => ({ name, id, svcId, pick, label, line });
const ROAD = { suspended: "通行止あり", delay: "規制あり" };
const JR = { delay: "遅れ・運休" }; // JR北海道の情報は遅れと運休の区別がない
export const SUMMARY = [
  {
    id: "airport",
    name: "札幌 ⇄ 新千歳空港",
    means: [
      means("JR 快速エアポート", "jr", "jr", (s) => s.items?.find((i) => i.id === "airport")?.status, JR),
      means("中央バス 空港連絡バス", "chuobus", "chuobus", (s) => s.groups?.find((g) => g.id === "airport")?.status, { delay: "運休あり" }),
      // 桑園線・定山渓線は通年「全便運休」のことがあるので、主要な2系統だけで見る
      means("北都交通 空港連絡バス", "hokto", "hokto", (s) =>
        worst((s.items || []).filter((i) => ["sapporo-chitose", "oyachi-chitose"].includes(i.id)).map((i) => i.status)),
        { delay: "一部運休", suspended: "全便運休" }
      ),
      means("道央道", "expressway", "expressway", (s) => s.roads?.find((r) => r.id === "doo")?.status, ROAD),
    ],
  },
  {
    id: "otaru",
    name: "札幌 ⇄ 小樽",
    means: [
      means("JR 函館線", "jr", "jr", (s) => s.items?.find((i) => i.id === "hakochise")?.status, JR),
      means("高速おたる号", "chuobus", "chuobus", (s) => s.groups?.find((g) => g.id === "otaru")?.status, { delay: "運休あり" }),
      means("札樽道", "expressway", "expressway", (s) => s.roads?.find((r) => r.id === "sasson")?.status, ROAD),
    ],
  },
  {
    id: "subway",
    name: "札幌市内（地下鉄）",
    means: ["nanboku", "tozai", "toho"].map((line) =>
      means(
        { nanboku: "南北線", tozai: "東西線", toho: "東豊線" }[line],
        "subway",
        "subway",
        (s) => s.items?.find((i) => i.id === line)?.status,
        { delay: "遅れあり", suspended: "見合わせ" },
        line
      )
    ),
  },
  {
    id: "honshu",
    name: "北海道 ⇄ 本州",
    means: [
      means(
        "新千歳空港の便",
        "airport",
        "airport",
        (s) => worst((s.groups || []).map((g) => g.status)),
        { delay: "遅れ・欠航あり", suspended: "大規模欠航" }
      ),
      // 丘珠空港は道内便が大半なので、本州行き（秋田・新潟など）の状況そのものではなく、空港全体の状態
      means(
        "丘珠空港の便",
        "okadama",
        "okadama",
        (s) => (s.groups?.length ? worst(s.groups.map((g) => g.status)) : "offhours"),
        { delay: "遅れ・欠航あり", suspended: "大規模欠航" }
      ),
      means("JR 特急・新幹線", "jr", "jr", (s) =>
        worst((s.items || []).filter((i) => ["express", "shinkansen"].includes(i.id)).map((i) => i.status)),
        JR
      ),
      means("シルバーフェリー", "ferry", "silverferry", (s) => s.status, { delay: "欠航・遅延あり" }),
      means("さんふらわあ", "ferry", "sunflower", (s) => s.status, { delay: "遅れあり", suspended: "欠航あり" }),
      // 新日本海フェリーは小樽港（と苫小牧東港）から日本海側へ出るので、路線図（routemap.js）では小樽から上へ出して消えていく線にする
      means("新日本海フェリー", "ferry", "snf", (s) => s.status, { delay: "お知らせあり" }),
      means("太平洋フェリー", "ferry", "taiheiyo", (s) => s.status, { delay: "遅れあり", suspended: "欠航あり" }),
    ],
  },
];
const CHIP_LABEL = { normal: "平常", delay: "乱れあり", suspended: "運休あり", offhours: "時間外", unknown: "取得できず" };

// 行き先1つ分：手段ごとの状態と、行き先全体の判定
function judge(dest, services) {
  const chips = dest.means
    .filter((m) => services[m.svcId])
    .map((m) => {
      const svc = services[m.svcId];
      // 取得に失敗している事業者は、前回のデータで判定せず「取得できず」にする
      const st = (svc.ok && m.pick(svc)) || "unknown";
      return { ...m, st, text: m.label[st] || CHIP_LABEL[st] };
    });
  // 時間外・取得できずは判定に使わない
  const known = chips.map((c) => c.st).filter((st) => ["normal", "delay", "suspended"].includes(st));
  let verdict = ["unknown", "判定できません"];
  if (known.length && known.every((st) => st === "normal")) verdict = ["normal", "平常"];
  else if (known.includes("normal")) verdict = ["delay", "一部に乱れ（平常の手段あり）"];
  else if (known.length && known.every((st) => st === "suspended")) verdict = ["suspended", "すべて運休・通行止"];
  else if (known.length) verdict = ["suspended", "すべての手段に乱れ"];
  return { ...dest, chips, verdict };
}

// 手段1つ分の線（札幌の地下鉄の横の短い線）
const track = (c) =>
  `<li><a class="dl-track dl-track--${esc(c.line)} is-${esc(c.st)}" href="#dl-${esc(c.id)}" aria-label="${esc(`${c.name}：${c.text}`)}">
      <span class="dl-track__line"></span><span class="dl-track__mark" aria-hidden="true">${mark(c.st)}</span>
      <span class="dl-track__label" aria-hidden="true">${esc(c.name)}${badge(c.st, c.text)}</span>
    </a></li>`;

// 路線図は1つの grid に描く。列は「左の余白・線の列（col）・右の駅名と判定」、行は「駅・駅のあいだ」を交互に並べる
// （1行目は上へ出す線、駅 i は 2i+2 行目、駅 i と i+1 のあいだは 2i+3 行目）。線は行ごとに1つずつ置き、名前と印は1つの区間にだけ付ける
// 配線は routemap.js（ROUTEMAP）。手段は名前で置き方を引き、置き方のない手段は描かない
// マスの置き場所は style の --row・--col（・--col-end）で渡し、grid-area などは delay.css の .dl-map の中で決める
const cell = (row, col, colEnd) => `style="--row: ${row}; --col: ${col}${colEnd ? `; --col-end: ${colEnd}` : ""}"`;
function renderMap(groups) {
  const map = ROUTEMAP;
  const at = (name) => map.stations.findIndex((s) => s.name === name);
  const placed = (c) => map.lines[c.name] && { via: [], ...c, ...map.lines[c.name] };
  const extras = map.extras.map((x) => ({ via: [], ...x, line: "plain", st: "plain" }));
  const lines = [...Object.values(groups).flatMap((g) => g.chips.map(placed).filter(Boolean)), ...extras];
  const n = Math.max(1, ...lines.map((l) => l.col), ...map.stations.map((s) => s.right || 0));
  const stRow = (i) => 2 * i + 2;
  const segRow = (i) => 2 * i + 3;
  const cells = [];
  // 右の列（駅のあいだの判定・灰色の線の名前・駅の補足・topNote）は2026-11-19にやめた（ユーザーの希望）。路線図は線と駅だけ
  const piece = (l, row, mod) =>
    cells.push(
      `<span class="dl-track dl-track--${esc(l.line)} is-${esc(l.st)} ${mod}" ${cell(row, l.col + 1)} data-line="${esc(
        l.name
      )}"><span class="dl-track__line"></span></span>`
    );

  // 線が通る区間（駅 i と i+1 のあいだが i。上へ出す線は -1 ＝いちばん上の行）
  const spans = new Map();
  for (const l of lines) {
    const a = at(l.from);
    const b = l.up ? a : at(l.to);
    if (a < 0 || (!l.up && b <= a)) continue;
    spans.set(l, l.up ? [-1] : Array.from({ length: b - a }, (_, i) => a + i));
  }
  // 縦書きの名前を置く区間を選ぶ。名前の長さで区間の高さが決まるので、すでに長い区間に入れて全体を短くする
  // （名前のない区間は、通過する線だけの短い区間になる）。置き場所が1つしかない線から決め、同じ高さなら始まりに近い区間
  // 灰色の線の名前は縦書きにせず、右の列に横書きで添える
  const size = (l) => [...l.name].length + (l.text ? [...l.text].length + 1 : 0);
  const height = new Map();
  const labelAt = new Map();
  const order = [...spans.keys()].filter((l) => l.st !== "plain").sort((p, q) => spans.get(p).length - spans.get(q).length || size(q) - size(p));
  for (const l of order) {
    const segs = spans.get(l);
    const h = (k) => height.get(k) || 0;
    const k = segs.find((k) => h(k) >= size(l)) ?? segs.reduce((best, k) => (h(k) > h(best) ? k : best));
    labelAt.set(l, k);
    height.set(k, Math.max(h(k), size(l)));
  }

  // 駅ごとの停まる線の列（始まり・終わり・途中で停まる線）。駅のカプセルはこの列だけにかぶせ、通過する線はその外を通す
  const stops = map.stations.map(() => []);
  for (const [l, segs] of spans) {
    const a = at(l.from);
    const b = l.up ? a : at(l.to);
    stops[a].push(l.col);
    stops[b].push(l.col);
    for (const v of l.via) if (at(v) > a && at(v) < b) stops[at(v)].push(l.col);
    // 駅の行：始まりは下半分（上へ出す線は上半分）、終わりは上半分、途中は停まるなら駅の下・通過なら駅の上に重ねる
    if (l.up) piece(l, stRow(a), "dl-track--top");
    else {
      piece(l, stRow(a), "dl-track--bottom");
      piece(l, stRow(b), "dl-track--top");
    }
    for (let j = a + 1; j < b; j++) piece(l, stRow(j), l.via.includes(map.stations[j].name) ? "dl-track--stop" : "dl-track--pass");
    const k = labelAt.get(l);
    for (const s of segs) if (s !== k) piece(l, l.up ? 1 : segRow(s), "dl-track--more");
    if (k === undefined) continue;
    // 名前と印を置く区間
    const label = `<span class="dl-track__line"></span><span class="dl-track__mark" aria-hidden="true">${mark(l.st)}</span><span class="dl-track__label" aria-hidden="true">${esc(l.name)}${l.text ? badge(l.st, l.text) : ""}</span>`;
    const attrs = `class="dl-track dl-track--${esc(l.line)} is-${esc(l.st)}${l.up ? " dl-track--up" : ""}" ${cell(
      l.up ? 1 : segRow(k),
      l.col + 1
    )} data-line="${esc(l.name)}"`;
    cells.push(`<a ${attrs} href="#dl-${esc(l.id)}" aria-label="${esc(`${l.name}：${l.text}`)}">${label}</a>`);
  }
  map.stations.forEach((st, i) => {
    const row = stRow(i);
    const b = st.branch && groups[st.branch];
    const branch = b?.chips.length
      ? `<div class="dl-map__branch">
            <span class="dl-map__branch-name">${esc(b.name)}</span>
            <ul class="dl-map__stubs">${b.chips.map(track).join("")}</ul>
          </div>`
      : "";
    // 停まる線の左端の列から右端の列まで（停まる線がなければ全部の列）。駅名と枝はカプセルの中に入れ、入りきらなければ右へ広げる。
    // 通過する線はカプセルの上に重なるので、駅名と枝は同じ形の箱をもう1枚、線より上に重ねて書く（下のカプセルの中身は大きさを決めるだけ）
    // routemap.js の駅に left・right（列の番号）があれば、そちらを使う
    const cols = stops[i];
    const from = st.left ? st.left + 1 : cols.length ? Math.min(...cols) + 1 : 1;
    const to = Math.max(from + 1, st.right ? st.right + 2 : cols.length ? Math.max(...cols) + 2 : n + 2);
    const box = (cls, attrs = "") =>
      `<div class="dl-map__stop${branch ? " dl-map__stop--tall" : ""}${cls}" ${cell(row, from, to)}${attrs}>
          <span class="dl-map__station">${esc(st.name)}</span>${branch}
        </div>`;
    cells.push(box("", ' aria-hidden="true"'), box(" dl-map__stop--label"));
  });
  return `<div class="dl-map" style="--n: ${n}">${cells.join("")}</div>`;
}

export function renderSummary(services) {
  const groups = Object.fromEntries(SUMMARY.map((dest) => [dest.id, judge(dest, services)]));
  return `<section class="dl-card dl-summary" id="dl-summary">
      <h2 class="dl-card__title">行き先ごとのまとめ</h2>
      ${renderMap(groups)}
      <p class="dl-map__legend">${[
        ["normal", "平常"],
        ["delay", "乱れあり"],
        ["suspended", "運休・通行止"],
        ["offhours", "時間外"],
        ["unknown", "取得できず"],
      ]
        .map(([st, text]) => `<span>${mark(st)}${text}</span>`)
        .join("")}</p>
      <p class="dl-card__note">各社の情報を行き先ごとに並べたものです。線を押すと詳しいカードへ移ります。駅の上に重なっている線は、その駅には寄りません。北都交通は都心線・大谷地線、JR は快速エアポート・函館線（札幌近郊）・特急・新幹線で見ています。</p>
    </section>`;
}
