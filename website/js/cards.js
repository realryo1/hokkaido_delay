// 各社のカード（#sections の中身）。main.js が JSON を受け取るたびに renderCards で描き直す
import { esc, hhmm, md, badge } from "./util.js";
import { OFFICIAL, officialUrl, jrUrl, linkOr, SNF_LIST } from "./official.js";

// 1分ごとの描き直しで消えないよう、一覧の開閉とチェックの状態をここに持つ（出発・到着済の便は最初は隠す）
// 便の一覧は新千歳空港（airport）と丘珠空港（okadama）で別々に持つ。変えるのは main.js のイベント
export const ui = { flightsOpen: { airport: false, okadama: false }, showDone: { airport: false, okadama: false }, sailingsOpen: true };

// 取得に失敗した事業者：前回のデータに注意書きと公式リンクを添える
function staleNote(id, svc) {
  if (svc.ok) return "";
  const last = svc.last_success_at ? `（最終取得 ${hhmm(svc.last_success_at)}）` : "";
  return `<div class="dl-warn">
      <p>情報元との通信が一時的に途切れています${esc(last)}。最新の状況は公式案内を確認してください。</p>
      <a class="dl-warn__btn" href="${esc(officialUrl(id))}" target="_blank" rel="noopener">${esc(svc.name)} 公式の運行情報</a>
    </div>`;
}

// id（jr / subway / airport など）でカードにコーポレートカラーを付ける（delay.css の .dl-card--{id}）
function card(id, svc, body, timeText) {
  const time = timeText ? `<span class="dl-card__time">${esc(timeText)}</span>` : "";
  // 情報元へのボタン。取得失敗時は staleNote に目立つ公式ボタンがあるので出さない
  const source = svc.ok
    ? `<a class="dl-source" href="${esc(officialUrl(id))}" target="_blank" rel="noopener">情報元：${esc(svc.name)}</a>`
    : "";
  return `<section class="dl-card dl-card--${esc(id)}" id="dl-${esc(id)}">
      <h2 class="dl-card__title"><a href="${esc(officialUrl(id))}" target="_blank" rel="noopener">${esc(svc.name)}</a>${time}</h2>
      ${staleNote(id, svc)}
      ${svc.ok || svc.last_success_at ? body : ""}
      ${source}
    </section>`;
}

function renderJr(svc) {
  const rows = (svc.items || [])
    .map(
      (i) => `<tr>
          <th scope="row"><a href="${esc(jrUrl(i.id))}" target="_blank" rel="noopener">${esc(i.name)}</a></th>
          <td>${badge(i.status, i.status === "delay" ? "遅れ・運休" : "")}</td>
          <td>${badge(i.tomorrow, i.tomorrow === "delay" ? "運休など" : "")}</td>
        </tr>`
    )
    .join("");
  const body = `<table class="dl-table">
      <thead><tr><th></th><th>本日</th><th>明日</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p class="dl-card__note">JR北海道の情報は「運休・30分以上の遅れ・運転見合わせがあるかどうか」のみです。深夜はサービス時間外になります。詳しくは各線区のリンク先へ。</p>`;
  return card("jr", svc, body, svc.source_time);
}

function renderSubway(svc) {
  const rows = (svc.items || [])
    .map(
      (i) => `<li class="dl-row">
          <span class="dl-row__name dl-line dl-line--${esc(i.id)}">${esc(i.name)}</span>
          ${badge(i.status)}
          ${i.message ? `<span class="dl-row__msg">${esc(i.message)}</span>` : ""}
        </li>`
    )
    .join("");
  return card("subway", svc, `<ul class="dl-rows">${rows}</ul>`, svc.ok ? `${hhmm(svc.fetched_at)} 取得` : "");
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
      return `<li class="dl-row dl-airrow dl-air--${esc(g.id)}">
          <span class="dl-row__name">${esc(g.name)}</span>
          ${badge(g.status, label)}
          <span class="dl-row__msg">${esc(parts.join(" / "))}</span>
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
  const list = all.length
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
  const body = `<ul class="dl-rows">${groups}</ul>${empty}${list}
      <p class="dl-card__note">${note}</p>`;
  return card(id, svc, body, svc.ok ? (svc.source_time ? `${hhmm(svc.source_time)} 時点` : `${hhmm(svc.fetched_at)} 取得`) : "");
}

// 高速道路：路線ごとの状態と、重要な規制（通行止・チェーン規制・事故など）の区間。車線規制・除雪作業などは件数だけ出す
const ROAD_LABEL = { suspended: "通行止あり", delay: "規制あり", normal: "重要な規制なし" };
function renderExpressway(svc) {
  const rows = (svc.roads || [])
    .map((r) => {
      const major = (r.items || []).filter((x) => x.major);
      const minor = (r.items || []).length - major.length;
      const items = major
        .map(
          (x) => `<li>${badge(x.kind === "closed" ? "suspended" : "delay", x.label)}
              <span>${esc(x.section)}${x.direction ? `（${esc(x.direction)}）` : ""}${x.reason ? `　原因：${esc(x.reason)}` : ""}</span></li>`
        )
        .join("");
      return `<li class="dl-row">
          <span class="dl-row__name">${esc(r.name)}</span>
          ${badge(r.status, ROAD_LABEL[r.status])}
          ${items ? `<ul class="dl-subitems">${items}</ul>` : ""}
          ${minor ? `<span class="dl-row__msg">そのほかの規制（車線規制・除雪作業など） ${minor}件</span>` : ""}
        </li>`;
    })
    .join("");
  const body = `<ul class="dl-rows">${rows}</ul>
      <p class="dl-card__note">表示まで10〜15分ほど遅れることがあります。通行止・チェーン規制は急に変わるので、出発前に必ず公式の交通情報を確認してください。</p>`;
  return card("expressway", svc, body, svc.source_time ? `${hhmm(svc.source_time)} 時点` : "");
}

// 北海道中央バス：運休のある系統・便だけが載る（RSS）。遅れの情報はない
function renderChuobus(svc) {
  const rows = (svc.groups || [])
    .map((g) => {
      const items = (g.items || [])
        .map(
          (i) => `<li>${badge(i.status, i.label)}
              <span><a href="${esc(linkOr("chuobus", i.url, OFFICIAL.chuobus.url))}" target="_blank" rel="noopener">${esc(i.route || g.name)}</a>
              ${i.direction ? `（${esc(i.direction)}）` : ""}${i.time ? ` ${esc(i.time)}発` : ""}</span></li>`
        )
        .join("");
      return `<li class="dl-row">
          <span class="dl-row__name">${esc(g.name)}</span>
          ${badge(g.status, g.status === "normal" ? "運休情報なし" : "運休あり")}
          ${items ? `<ul class="dl-subitems">${items}</ul>` : ""}
        </li>`;
    })
    .join("");
  const body = `<ul class="dl-rows">${rows}</ul>
      <p class="dl-card__note">中央バスの情報は運休のみで、道路状況などによる遅れは載りません。運休の理由や詳しい便は各系統のリンク先へ。</p>`;
  return card("chuobus", svc, body, svc.ok ? `${hhmm(svc.fetched_at)} 取得` : "");
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
  const rows = items
    .filter((i) => !HOKTO_MINOR.includes(i.id))
    .map(
      (i) => `<li class="dl-row">
          <span class="dl-row__name"><a href="${esc(linkOr("hokto", i.url, OFFICIAL.hokto.url))}" target="_blank" rel="noopener">${esc(i.name)}</a></span>
          ${badge(i.status, i.label)}
          ${i.about ? `<span class="dl-row__msg">${esc(i.about)}</span>` : ""}
        </li>`
    )
    .join("");
  const body = `<ul class="dl-rows">${rows}</ul>${minorLine}
      <p class="dl-card__note">北都交通の情報は運休の有無のみで、道路状況などによる遅れは載りません。</p>`;
  return card("hokto", svc, body, svc.ok ? `${hhmm(svc.fetched_at)} 取得` : "");
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
  const about = llms
    .map((l) => `<li class="dl-llm">${AUTO}<span>${esc(l.summary)}${l.general?.length ? `<br>${l.general.map(esc).join("<br>")}` : ""}</span></li>`)
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
  const shown = svc.ok || svc.last_success_at;
  return `<li class="dl-row">
      <span class="dl-row__name dl-line dl-line--${esc(id)}"><a href="${esc(officialUrl(id))}" target="_blank" rel="noopener">${esc(svc.name)}</a></span>
      ${shown ? badge(svc.status, label) : ""}
      ${shown && msg ? `<span class="dl-row__msg">${msg}</span>` : ""}
      ${shown ? extra : ""}
      ${staleNote(id, svc)}
    </li>`;
}
function renderFerry(services) {
  const rows = FERRIES.filter((id) => services[id]).map((id) => ferryRow(id, services[id]));
  if (!rows.length) return "";
  return `<section class="dl-card" id="dl-ferry">
      <h2 class="dl-card__title">フェリー（北海道航路）<span class="dl-card__time">${esc(hhmm(services[FERRIES.find((id) => services[id])].fetched_at))} 取得</span></h2>
      <ul class="dl-rows">${rows.join("")}</ul>
      <p class="dl-card__note">各社のトップページの運航情報から状態だけを表示しています（シルバーフェリー・さんふらわあ・新日本海フェリーは、お知らせが出ているときだけ便ごとの状況を読み取ります）。「Haiku5.5による補足」は、お知らせを AI（Claude Haiku 5.5）で読み取った要約・補足・臨時便などで、誤りがあることがあります。詳しい案内は各社のリンク先へ。</p>
    </section>`;
}

const RENDER = {
  jr: renderJr,
  subway: renderSubway,
  airport: (svc) => renderAirport("airport", svc),
  okadama: (svc) => renderAirport("okadama", svc, AIRLINE_SHORT_OKADAMA),
  expressway: renderExpressway,
  chuobus: renderChuobus,
  hokto: renderHokto,
};

// 各社のカードを決まった順に並べ、最後にフェリーの1枚
export const renderCards = (services) =>
  Object.entries(RENDER)
    .filter(([id]) => services[id])
    .map(([id, fn]) => fn(services[id]))
    .join("") + renderFerry(services);

// Worker に一度もつながらなかったとき（前回の内容もない）に出す公式リンク
export const officialLinks = () =>
  `<section class="dl-card">
      <h2 class="dl-card__title">各社の公式の運行情報</h2>
      <ul class="dl-links">${Object.values(OFFICIAL)
        .map((o) => `<li><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.name)}</a></li>`)
        .join("")}</ul>
    </section>`;
