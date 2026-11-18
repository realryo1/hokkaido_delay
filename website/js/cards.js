// 各社のカード（#sections の中身）。main.js が JSON を受け取るたびに renderCards で描き直す
import { esc, hhmm, md, badge, MARK } from "./util.js";
import { OFFICIAL, officialUrl, jrUrl, linkOr, SNF_LIST } from "./official.js";

// 1分ごとの描き直しで消えないよう、一覧の開閉とチェックの状態をここに持つ（出発・到着済の便は最初は隠す）
// 便の一覧は新千歳空港（airport）と丘珠空港（okadama）で別々に持つ。変えるのは main.js のイベント
export const ui = { flightsOpen: { airport: false, okadama: false }, showDone: { airport: false, okadama: false }, sailingsOpen: true };

// 取得に失敗している事業者：見出し（フェリーは社名）の横に小さく「情報途絶（最終取得 07:57）」と出す。
// 状態は前回のものを出さず「？ 情報途絶」にする。公式へは見出し（社名）のリンクから
const STALE = "情報途絶";
const staleTag = (svc) =>
  svc.ok ? "" : `<span class="dl-stale">${STALE}${svc.last_success_at ? `（最終取得 ${esc(hhmm(svc.last_success_at))}）` : ""}</span>`;

// カードの備考。カードの中には出さず、renderCards が最後の「備考」の枠にまとめて出す（縦の長さを減らし、状態を先に見せるため）
let notes = [];

// id（jr / subway / airport など）でカードにコーポレートカラーを付ける（delay.css の .dl-card--{id}）
// 見出しが公式の運行情報へのリンクを兼ねる。note は備考（最後の枠に回す）
function card(id, svc, body, timeText, note = "") {
  const time = svc.ok ? (timeText ? `<span class="dl-card__time">${esc(timeText)}</span>` : "") : staleTag(svc);
  if (note && (svc.ok || svc.last_success_at)) notes.push({ name: svc.name, note });
  return `<section class="dl-card dl-card--${esc(id)}" id="dl-${esc(id)}">
      <h2 class="dl-card__title"><a href="${esc(officialUrl(id))}" target="_blank" rel="noopener">${esc(svc.name)}</a>${time}</h2>
      ${svc.ok || svc.last_success_at ? body : ""}
    </section>`;
}

// 路線・系統1つ分の正方形のタイル。名前と、大きな印（○△×−？）と状態の言葉だけで見せる。名前の（）の中（区間など）は出さない
//   { name, status, label, href, line }。line は上の帯の色（地下鉄のラインカラーなど。delay.css の .dl-line--*）
const TILE_LABEL = { normal: "平常", delay: "遅れあり", suspended: "運休", offhours: "時間外", unknown: "取得できず" };
function tile({ name, status, label, href, line }) {
  const inner = `<span class="dl-tile__name">${esc(name.replace(/（.*$/, ""))}</span>
      <span class="dl-tile__mark" aria-hidden="true">${MARK[status] || MARK.unknown}</span>
      <span class="dl-tile__label">${esc(label || TILE_LABEL[status] || TILE_LABEL.unknown)}</span>`;
  const cls = `dl-tile is-${esc(status || "unknown")}${line ? ` dl-line--${esc(line)}` : ""}`;
  return `<li>${href ? `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener">${inner}</a>` : `<div class="${cls}">${inner}</div>`}</li>`;
}
// タイルを並べる。取得に失敗しているときは、前回の状態ではなく「？ 情報途絶」にする
const tiles = (svc, list) =>
  `<ul class="dl-tiles">${list.map((o) => tile(svc.ok ? o : { ...o, status: "unknown", label: STALE })).join("")}</ul>`;
// タイルの下に並べる明細（高速道路の重要な規制の区間、中央バスの系統）。ないとき・取得に失敗しているときは出さない
const details = (svc, items) => (svc.ok && items.length ? `<ul class="dl-subitems">${items.join("")}</ul>` : "");

// JR北海道：本日の状態だけ（明日は出さない）。函館線・千歳線と学園都市線は「札幌近郊」の1枚にまとめ、悪い方の状態を出す
const WORSE = { suspended: 4, delay: 3, unknown: 2, normal: 1, offhours: 0 };
const JR_SAPPORO = ["hakochise", "gakuen"];
function renderJr(svc) {
  const items = svc.items || [];
  const near = items.filter((i) => JR_SAPPORO.includes(i.id));
  const list = items.flatMap((i) => {
    if (!JR_SAPPORO.includes(i.id)) return [i];
    if (i !== near[0]) return [];
    const worst = near.reduce((a, b) => ((WORSE[b.status] ?? 2) > (WORSE[a.status] ?? 2) ? b : a));
    return [{ ...worst, id: near[0].id, name: "札幌近郊" }];
  });
  const body = tiles(svc, list.map((i) => ({ name: i.name, status: i.status, label: i.status === "delay" ? "遅れ・運休" : "", href: jrUrl(i.id) })));
  const note = "運休・30分以上の遅れ・運転見合わせがあるかどうかだけです。深夜はサービス時間外です。詳しくは各線区のリンク先へ。";
  return card("jr", svc, body, svc.source_time, note);
}

// 地下鉄：路線ごとのタイル（札幌市の案内の文言は状態と同じことなので出さない）
function renderSubway(svc) {
  const body = tiles(svc, (svc.items || []).map((i) => ({ name: i.name, status: i.status, line: i.id })));
  return card("subway", svc, body, svc.ok ? `${hhmm(svc.fetched_at)} 取得` : "");
}

const KIND = { cancelled: "欠航", delayed: "遅れ", diverted: "引き返し等" };
const KIND_STATUS = { cancelled: "suspended", delayed: "delay", diverted: "suspended", done: "done" };
// 出発・到着済みで30分以上遅れた便（kind: "done"）は、これから飛ぶ便と見分けられるよう薄い色にする
// 一覧の社名の列に出す短い表記（運航会社コード → 名前）。ない会社は空港データの社名をそのまま出す
const AIRLINE_SHORT = {
  ANA: "ANA",
  AKX: "ANA",
  ADO: "AIRDO",
  IBX: "IBEX",
  JAL: "JAL",
  JLJ: "J-AIR",
  NTH: "HAC",
  FDA: "FDA",
  SKY: "スカイマーク",
  APJ: "Peach",
  JJP: "ジェットスター",
  SJO: "春秋航空",
  SNJ: "ソラシド",
};
// 丘珠空港の一覧の社名（便名の先頭3文字は worker/src/sources/okadama.js が付けたコード。HAC の便も JAL の便名で載る）
const AIRLINE_SHORT_OKADAMA = { JAL: "JAL・HAC", TOK: "トキエア", FDA: "FDA" };
const kindLabel = (f) => (f.kind === "done" ? (f.dir === "arrival" ? "遅れ（到着済）" : "遅れ（出発済）") : KIND[f.kind]);

// 新千歳空港と丘珠空港は同じ形のデータ（groups・flights）なので同じ描き方にする。short は社名の列に出す短い表記
function renderAirport(id, svc, short = AIRLINE_SHORT) {
  const groups = (svc.groups || [])
    .map((g) => {
      const label = g.status === "delay" ? "遅れ・欠航あり" : g.status === "suspended" ? "大規模欠航" : "";
      const parts = [`全${g.total}便`];
      if (g.cancelled) parts.push(`欠航 ${g.cancelled}`);
      if (g.diverted) parts.push(`引き返し等 ${g.diverted}`);
      if (g.delayed) parts.push(`遅れ ${g.delayed}`);
      if (g.done_late) parts.push(`30分以上遅れて出発・到着済 ${g.done_late}`);
      // 取得に失敗しているときは、前回の数字を出さず「情報途絶」にする
      return `<li class="dl-row dl-airrow dl-air--${esc(g.id)}">
          <span class="dl-row__name">${esc(g.name)}</span>
          ${svc.ok ? badge(g.status, label) : badge("unknown", STALE)}
          ${svc.ok ? `<span class="dl-row__msg">${esc(parts.join(" / "))}</span>` : ""}
        </li>`;
    })
    .join("");

  const all = svc.flights || [];
  const doneCount = all.filter((f) => f.kind === "done").length;
  const flights = ui.showDone[id] ? all : all.filter((f) => f.kind !== "done");
  const toggle = doneCount
    ? `<label class="dl-check"><input type="checkbox" data-show-done="${id}"${ui.showDone[id] ? " checked" : ""}> 出発・到着済を表示（${doneCount}便）</label>`
    : "";
  // 出発と到着で表を分ける。列は 航空会社・便名・行先（到着は出発地）・定刻・変更・状況 の順
  const flightTable = (dir, title, placeLabel) => {
    const rows = flights.filter((f) => f.dir === dir);
    if (!rows.length) return "";
    return `<h3 class="dl-flights__title">${title}（${rows.length}便）</h3>
          <table class="dl-table dl-table--flights">
            <colgroup><col class="dl-col-air"><col class="dl-col-no"><col><col class="dl-col-time"><col class="dl-col-est"><col class="dl-col-state"></colgroup>
            <thead><tr><th>航空会社</th><th>便名</th><th>${placeLabel}</th><th>定刻</th><th>変更</th><th>状況</th></tr></thead>
            <tbody>${rows
              .map(
                (f) => `<tr class="dl-airrow dl-air--${esc(String(f.flight).slice(0, 3))}${f.kind === "done" ? " is-done" : ""}">
                  <td class="dl-airname">${esc(short[String(f.flight).slice(0, 3)] || f.airline)}</td>
                  <td>${esc(f.flight)}</td>
                  <td>${esc(f.place)}</td>
                  <td>${esc(f.scheduled)}</td>
                  <td>${esc(f.estimated || "")}${f.delay_min > 0 ? `<small>（+${f.delay_min}分）</small>` : ""}</td>
                  <td>${badge(KIND_STATUS[f.kind] || "unknown", kindLabel(f))}</td>
                </tr>`
              )
              .join("")}</tbody>
          </table>`;
  };
  const table = flights.length
    ? flightTable("departure", "出発", "行先") + flightTable("arrival", "到着", "出発地")
    : `<p class="dl-card__note">これから出発・到着する便に、遅れ・欠航はありません。</p>`;
  const current = all.length - doneCount;
  const list = all.length && svc.ok
    ? `<details class="dl-flights" data-card="${id}"${ui.flightsOpen[id] ? " open" : ""}>
          <summary>遅れ・欠航の便（${current}便）</summary>
          ${toggle}
          ${table}
        </details>`
    : "";
  const note =
    id === "okadama"
      ? "航空会社ごとの集計です。備考が「目的地天候不良」の便は、引き返しなどの可能性がある便として数えます。丘珠空港は道内各地と秋田・新潟などを結び、新千歳空港が使えないときの代わりになることがあります。"
      : "運航会社ごとの集計です（コードシェア便は運航会社側に数えます）。";
  const empty = (svc.groups || []).length ? "" : `<p class="dl-card__note">現在、表示できるフライト情報がありません。</p>`;
  const body = `<ul class="dl-rows">${groups}</ul>${empty}${list}`;
  return card(id, svc, body, svc.ok ? (svc.source_time ? `${hhmm(svc.source_time)} 時点` : `${hhmm(svc.fetched_at)} 取得`) : "", note);
}

// 高速道路：路線ごとの状態と、重要な規制（通行止・チェーン規制・事故など）の区間。車線規制・除雪作業などは件数だけ出す
const ROAD_LABEL = { suspended: "通行止あり", delay: "規制あり", normal: "重要な規制なし" };
function renderExpressway(svc) {
  const roads = svc.roads || [];
  const items = roads.flatMap((r) => {
    const name = r.name.replace(/（.*$/, "");
    const major = (r.items || []).filter((x) => x.major);
    const minor = (r.items || []).length - major.length;
    return [
      ...major.map(
        (x) => `<li>${badge(x.kind === "closed" ? "suspended" : "delay", x.label)}
            <span><b>${esc(name)}</b> ${esc(x.section)}${x.direction ? `（${esc(x.direction)}）` : ""}${x.reason ? `　原因：${esc(x.reason)}` : ""}</span></li>`
      ),
      ...(minor ? [`<li><span><b>${esc(name)}</b> そのほかの規制（車線規制・除雪作業など） ${minor}件</span></li>`] : []),
    ];
  });
  const body = tiles(svc, roads.map((r) => ({ name: r.name, status: r.status, label: ROAD_LABEL[r.status] }))) + details(svc, items);
  const note = "表示まで10〜15分ほど遅れることがあります。通行止・チェーン規制は急に変わるので、出発前に必ず公式の交通情報を確認してください。";
  return card("expressway", svc, body, svc.source_time ? `${hhmm(svc.source_time)} 時点` : "", note);
}

// 北海道中央バス：運休のある系統・便だけが載る（RSS）。遅れの情報はない
function renderChuobus(svc) {
  const groups = svc.groups || [];
  const items = groups.flatMap((g) =>
    (g.items || []).map(
      (i) => `<li>${badge(i.status, i.label)}
          <span><a href="${esc(linkOr("chuobus", i.url, OFFICIAL.chuobus.url))}" target="_blank" rel="noopener">${esc(i.route || g.name)}</a>
          ${i.direction ? `（${esc(i.direction)}）` : ""}${i.time ? ` ${esc(i.time)}発` : ""}</span></li>`
    )
  );
  const body = tiles(svc, groups.map((g) => ({ name: g.name, status: g.status, label: g.status === "normal" ? "運休情報なし" : "運休あり" }))) + details(svc, items);
  const note = "運休だけで、道路状況などによる遅れは載りません。運休の理由や詳しい便は各系統のリンク先へ。";
  return card("chuobus", svc, body, svc.ok ? `${hhmm(svc.fetched_at)} 取得` : "", note);
}

// 北都交通：空港連絡バスの系統ごとの状態（平常運行・一部区間運休・全便運休）。文言は北都交通の表記のまま
// 桑園線・定山渓線は通年「全便運休」のことが多く、来訪者にはほぼ関係ないので、最後に小さく1行にまとめる
const HOKTO_MINOR = ["souen-chitose", "chitose-jyozankei"];
function renderHokto(svc) {
  const items = svc.items || [];
  const minor = items.filter((i) => HOKTO_MINOR.includes(i.id));
  const minorLine = minor.length
    ? `<p class="dl-minor">${minor
        .map((i) => `<a href="${esc(linkOr("hokto", i.url, OFFICIAL.hokto.url))}" target="_blank" rel="noopener">${esc(i.name)}</a> ${esc(i.label)}`)
        .join("／")}</p>`
    : "";
  const body =
    tiles(
      svc,
      items.filter((i) => !HOKTO_MINOR.includes(i.id)).map((i) => ({ name: i.name, status: i.status, label: i.label, href: linkOr("hokto", i.url, OFFICIAL.hokto.url) }))
    ) + (svc.ok ? minorLine : "");
  return card("hokto", svc, body, svc.ok ? `${hhmm(svc.fetched_at)} 取得` : "", "運休の有無だけで、道路状況などによる遅れは載りません。");
}

// フェリー：4社とも1行ずつなので1枚のカードにまとめる。取得に失敗した会社は、その行に注意と公式リンクを出す
//   シルバーフェリー：定型の文言（通常運航しています／欠航または遅延便があります）。お知らせから読んだ便ごとの状況
//   さんふらわあ：自由記述の欄から判定した状態（文章は表示しない）。平常時以外は欄から読んだ便ごとの状況
//   新日本海フェリー：運航状況のお知らせの件数と日付（題名は表示しない）。お知らせから読んだ欠航・遅れの便
//   太平洋フェリー：さんふらわあと同じく、自由記述の欄から判定した状態だけ
// 便は正規表現で読んだもの。シルバーフェリー・さんふらわあ・新日本海フェリーは、LLM（Haiku 5.5）が読んだ要約・案内・補足・臨時便などに印を付けて重ねる
const FERRIES = ["silverferry", "sunflower", "snf", "taiheiyo"];
// シルバーフェリーの便ごとの行の色（delay.css の .dl-ship--*。plan.js の SHIP_CLASS と同じ）。代船などは灰色
const SILVER_SHIP = { シルバープリンセス: "princess", シルバーティアラ: "tiara", シルバーブリーズ: "breeze", シルバーエイト: "eight" };
const AUTO = `<span class="dl-auto">Haiku5.5による補足</span>`;
// 出港・到着の時刻（"2026-04-21T03:15" と済かどうか）→「4/21 03:15予定」
const atText = (a) => `${md(a.at)} ${hhmm(a.at)}${a.done ? "" : "予定"}`;
// 便の補足（LLM が読んだもの）。LLM が足した便は行に印があるので補足には付けない。船名は、正規表現で読んだ会社では行に出す
function sailingNote(s, shipInLine) {
  const xs = [];
  if (s.depart) xs.push(`出港${s.depart}`);
  if (s.depart_at) xs.push(`出港${atText(s.depart_at)}`);
  if (s.arrive) xs.push(`到着${s.arrive}`);
  if (s.arrive_at) xs.push(`到着${atText(s.arrive_at)}`);
  if (s.runs_to?.length) xs.push(`${s.runs_to.join("・")}へは運航`);
  if (s.ship && !shipInLine) xs.push(s.ship);
  xs.push(...(s.notes || []));
  return xs.length ? `<span class="dl-sailing-note">${esc(xs.join("・"))}${s.source === "llm" ? "" : ` ${AUTO}`}</span>` : "";
}
// 便の一覧（開閉できる）。llms は LLM の結果（要約・案内を先頭に出す）。unread は読めない書き方の便があるか
// shipInLine は、正規表現で読んだ船名を line で行に出しているか（補足に重ねて出さない）
// 見出しは「title（count便・at）」
function sailingsBlock({ title, count, at, list, llms, unread, rowClass, line, shipInLine }) {
  if (!list.length && !unread && !llms.length) return "";
  // 便は出港の日時の順に並べる（お知らせは出発港ごとに書かれているので、そのままだと時間が行ったり来たりする）。同じ日時は出発港の順
  list = [...list].sort((a, b) => `${a.date} ${a.time} ${a.from}`.localeCompare(`${b.date} ${b.time} ${b.from}`));
  // 要約は先頭に「理由：」、日付ごとの行（「11月18日：…」）、日付に結び付かない案内は最後に「その他：」で出す（要約が文字列だった版の結果もそのまま出す）
  const about = llms
    .map((l) => {
      const reason = l.reason ? [`理由：${esc(l.reason)}`] : [];
      const days = Array.isArray(l.summary) ? l.summary.map((x) => `${esc(x.label)}：${esc(x.text)}`) : [esc(l.summary)];
      const other = (l.general || []).map((g, i) => `${i ? "" : "その他："}${esc(g)}`);
      return `<li class="dl-llm">${AUTO}<span>${[...reason, ...days, ...other].join("<br>")}</span></li>`;
    })
    .join("");
  return `<details class="dl-sailings"${ui.sailingsOpen ? " open" : ""}>
      <summary>${esc(title)}（${count}便${at ? `・${esc(at)}` : ""}）</summary>
      <ul class="dl-subitems">${about}${list
        .map((s) => `<li class="dl-ship dl-ship--${esc(rowClass(s))}">${badge(s.status, s.label)}<span>${line(s)}${s.source === "llm" ? ` ${AUTO}` : ""}${sailingNote(s, shipInLine)}</span></li>`)
        .join("")}${unread ? `<li>${badge("delay", "お知らせで確認")}<span>読み取れない書き方の便があります</span></li>` : ""}</ul>
    </details>`;
}
const asOf = (iso) => (iso ? `${md(iso)} ${hhmm(iso)} 現在` : "");
function ferryRow(id, svc) {
  let label = "";
  let msg = "";
  let extra = "";
  if (id === "silverferry") {
    label = svc.message;
    if (svc.notice_url) msg = `<a href="${esc(linkOr("silverferry", svc.notice_url, OFFICIAL.silverferry.url))}" target="_blank" rel="noopener">お知らせ</a>`;
    // 欠航・遅延のお知らせから読んだ便ごとの状況（日付・出発港・時刻・船名）。平常時はない
    const list = svc.sailings || [];
    extra = sailingsBlock({
      title: "便ごとの状況",
      count: list.length,
      at: asOf(svc.source_time),
      list,
      llms: svc.llm?.ok ? [svc.llm] : [],
      unread: svc.unread > 0,
      rowClass: (s) => SILVER_SHIP[s.ship] || "other",
      line: (s) => `${esc(md(s.date))} ${esc(s.from)}→${esc(s.to)} ${esc(s.time)}発 ${esc(s.ship || "")}`,
      shipInLine: true,
    });
  } else if (id === "sunflower" || id === "taiheiyo") {
    label = svc.label;
    if (svc.source_time) msg = `${esc(md(svc.source_time))} ${esc(hhmm(svc.source_time))} 現在の案内`;
    // さんふらわあの平常時以外：欄から読んだ便ごとの状況（日付・出発港・深夜便／夕方便・時刻・船名）
    if (id === "sunflower") {
      const list = svc.sailings || [];
      extra = sailingsBlock({
        title: "便ごとの状況",
        count: list.length,
        at: "",
        list,
        llms: svc.llm?.ok ? [svc.llm] : [],
        unread: svc.unread > 0,
        rowClass: () => "other",
        line: (s) => `${esc(md(s.date))} ${esc(s.from)}→${esc(s.to)} ${esc(s.kind || "")}${esc(s.time)}発 ${esc(s.ship || "")}`,
        shipInLine: true,
      });
    }
  } else {
    label = svc.notices?.length ? `運航状況のお知らせ ${svc.notices.length}件` : "運航状況のお知らせなし";
    msg = (svc.notices || [])
      .map((n) => `<a href="${esc(linkOr("snf", n.url, SNF_LIST))}" target="_blank" rel="noopener">お知らせ（${esc(md(n.date))}）</a>`)
      .join("　");
    // お知らせから読んだ便（欠航・遅れの見出しの下の便）
    const notices = svc.notices || [];
    const list = notices.flatMap((n) => n.sailings || []);
    const times = notices.map((n) => n.time).filter(Boolean).sort();
    extra = sailingsBlock({
      title: "欠航・遅れの便",
      count: list.filter((s) => s.status !== "normal").length,
      at: asOf(times.at(-1)),
      list,
      llms: notices.map((n) => n.llm).filter((l) => l?.ok),
      unread: notices.some((n) => n.unread > 0 || (n.sailings === null && n.url)),
      rowClass: () => "other",
      shipInLine: false,
      line: (s) => `${esc(md(s.date))} ${esc(s.from)}→${esc(s.to)}${s.via?.length ? `（${esc(s.via.join("・"))}経由）` : ""} ${esc(s.time)}発`,
    });
  }
  // 取得に失敗しているときは、社名の横に「情報途絶（最終取得 …）」、状態は「情報途絶」にして、前回のお知らせ・便は出さない
  return `<li class="dl-row">
      <span class="dl-row__name dl-line dl-line--${esc(id)}"><a href="${esc(officialUrl(id))}" target="_blank" rel="noopener">${esc(svc.name)}</a>${staleTag(svc)}</span>
      ${svc.ok ? badge(svc.status, label) : badge("unknown", STALE)}
      ${svc.ok && msg ? `<span class="dl-row__msg">${msg}</span>` : ""}
      ${svc.ok ? extra : ""}
    </li>`;
}
function renderFerry(services) {
  const rows = FERRIES.filter((id) => services[id]).map((id) => ferryRow(id, services[id]));
  if (!rows.length) return "";
  notes.push({
    name: "フェリー",
    note: "各社のトップページの運航情報から状態だけを表示しています（シルバーフェリー・さんふらわあ・新日本海フェリーは、お知らせが出ているときだけ便ごとの状況を読み取ります）。「Haiku5.5による補足」は、お知らせを AI（Claude Haiku 5.5）で読み取った要約・補足・臨時便などで、誤りがあることがあります。詳しい案内は各社のリンク先へ。",
  });
  return `<section class="dl-card" id="dl-ferry">
      <h2 class="dl-card__title">フェリー（北海道航路）<span class="dl-card__time">${esc(hhmm(services[FERRIES.find((id) => services[id])].fetched_at))} 取得</span></h2>
      <ul class="dl-rows">${rows.join("")}</ul>
    </section>`;
}

// 各カードの備考をまとめた最後の枠
const renderNotes = () =>
  notes.length
    ? `<section class="dl-card dl-notes" id="dl-notes">
      <h2 class="dl-card__title">備考</h2>
      <dl>${notes.map((n) => `<dt>${esc(n.name)}</dt><dd>${esc(n.note)}</dd>`).join("")}</dl>
    </section>`
    : "";

const RENDER = {
  jr: renderJr,
  subway: renderSubway,
  airport: (svc) => renderAirport("airport", svc),
  okadama: (svc) => renderAirport("okadama", svc, AIRLINE_SHORT_OKADAMA),
  expressway: renderExpressway,
  chuobus: renderChuobus,
  hokto: renderHokto,
};

// 各社のカードを決まった順に並べ、フェリーの1枚、最後に備考の枠
export function renderCards(services) {
  notes = [];
  const html =
    Object.entries(RENDER)
      .filter(([id]) => services[id])
      .map(([id, fn]) => fn(services[id]))
      .join("") + renderFerry(services);
  return html + renderNotes();
}

// Worker に一度もつながらなかったとき（前回の内容もない）に出す公式リンク
export const officialLinks = () =>
  `<section class="dl-card">
      <h2 class="dl-card__title">各社の公式の運行情報</h2>
      <ul class="dl-links">${Object.values(OFFICIAL)
        .map((o) => `<li><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.name)}</a></li>`)
        .join("")}</ul>
    </section>`;
