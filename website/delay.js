// 運行情報（試験版）
// Cloudflare Worker（worker/）が5分ごとに集めた JSON を1本だけ取得して描画する。事業者サイトへは直接アクセスしない。
(() => {
  // Cloudflare Worker（worker/）の配信先。空にすると sample.json を表示する
  const ENDPOINT = "https://delay.realryo1.com/status.json";
  const REFRESH_MS = 60 * 1000;
  const STALE_MIN = 20; // これより古ければ「更新が止まっている」と表示

  const params = new URLSearchParams(location.search);
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  // ?sample でサンプル表示、手元確認のときだけ ?api=http://localhost:8787/status.json で取得先を差し替えられる
  const source = params.has("sample") || !ENDPOINT ? "sample.json" : (local && params.get("api")) || ENDPOINT;

  const $updated = document.getElementById("updated");
  const $banners = document.getElementById("banners");
  const $summary = document.getElementById("summary");
  const $sections = document.getElementById("sections");
  const $reload = document.getElementById("reload");

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // "2027-02-06T10:30:00+09:00" / "2027-02-06T10:14:03+0900" → "10:30"
  const hhmm = (iso) => (iso && /T(\d\d:\d\d)/.exec(iso)?.[1]) || "";

  const LABEL = {
    normal: "平常",
    delay: "遅れあり",
    suspended: "運休・見合わせ",
    unknown: "不明",
    offhours: "サービス時間外",
  };
  const badge = (status, label) => `<span class="dl-badge dl-badge--${esc(status)}">${esc(label || LABEL[status] || LABEL.unknown)}</span>`;

  // 各社の公式ページ。名前と URL は worker/src/collect.js の SOURCES と合わせる
  // リンクはここに直書きしたものを使い、JSON の url（取得先の記録として Worker が残している）は使わない。
  // 事業者のページから毎回取ってくるお知らせなどのリンクだけ、決まった形（https・ホスト・パス）のときに使う（javascript: などを入れないため）
  const OFFICIAL = {
    jr: { name: "JR北海道", url: "https://www3.jrhokkaido.co.jp/webunkou/" },
    subway: { name: "札幌市営地下鉄", url: "https://operationstatus.city.sapporo.jp/unkojoho/" },
    airport: { name: "新千歳空港（国内線）", url: "https://www.hokkaido-airports.com/ja/new-chitose/airport/fis/" },
    expressway: { name: "高速道路（アイハイウェイ）", url: "https://ihighway.jp/" },
    chuobus: { name: "北海道中央バス", url: "https://www.chuo-bus.co.jp/support/stop/" },
    hokto: { name: "北都交通", url: "https://www.hokto.co.jp/" },
    silverferry: { name: "シルバーフェリー（八戸〜苫小牧）", url: "https://www.silverferry.jp/" },
    sunflower: { name: "さんふらわあ（大洗〜苫小牧）", url: "https://www.sunflower.co.jp/" },
    snf: { name: "新日本海フェリー（舞鶴・敦賀・新潟・秋田〜小樽・苫小牧東）", url: "https://www.snf.jp/" },
  };
  const officialUrl = (id) => OFFICIAL[id]?.url || "";
  // JR北海道の線区ごとのページ（worker/src/sources/jr.js の LINES の senku と合わせる）
  const JR_SENKU = { airport: "02", hakochise: "03", gakuen: "04", express: "01", shinkansen: "24" };
  const jrUrl = (id) => (JR_SENKU[id] ? `${OFFICIAL.jr.url}senku.html?id=${JR_SENKU[id]}` : OFFICIAL.jr.url);
  // 毎回取ってくるリンク：形が合えばそのまま、合わなければ決まったページ
  const LINK = {
    chuobus: /^https:\/\/www\.chuo-bus\.co\.jp\/support\/stop\/\?ope=list&rsn=\d+&ket=\d+$/,
    hokto: /^https:\/\/www\.hokto\.co\.jp\/[a-z0-9-]+\/$/,
    silverferry: /^https:\/\/www\.silverferry\.jp\/[\w./-]+$/,
    snf: /^https:\/\/www\.snf\.jp\/[\w./-]+$/,
  };
  const SNF_LIST = "https://www.snf.jp/info-list/?info_group=operation";
  const linkOr = (id, url, fallback) => (typeof url === "string" && LINK[id].test(url) ? url : fallback);

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

  // 1分ごとの描き直しで消えないよう、一覧の開閉とチェックの状態をここに持つ（出発・到着済の便は最初は隠す）
  const ui = { flightsOpen: false, showDone: false, sailingsOpen: true };

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
  const kindLabel = (f) => (f.kind === "done" ? (f.dir === "arrival" ? "遅れ（到着済）" : "遅れ（出発済）") : KIND[f.kind]);

  function renderAirport(svc) {
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
    const flights = ui.showDone ? all : all.filter((f) => f.kind !== "done");
    const toggle = doneCount
      ? `<label class="dl-check"><input type="checkbox" data-show-done${ui.showDone ? " checked" : ""}> 出発・到着済を表示（${doneCount}便）</label>`
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
                  <td class="dl-airname">${esc(AIRLINE_SHORT[String(f.flight).slice(0, 3)] || f.airline)}</td>
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
      ? `<details class="dl-flights"${ui.flightsOpen ? " open" : ""}>
          <summary>遅れ・欠航の便（${current}便）</summary>
          ${toggle}
          ${table}
        </details>`
      : "";
    const body = `<ul class="dl-rows">${groups}</ul>${list}
      <p class="dl-card__note">運航会社ごとの集計です（コードシェア便は運航会社側に数えます）。</p>`;
    return card("airport", svc, body, svc.source_time ? `${hhmm(svc.source_time)} 時点` : "");
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

  // フェリー：3社とも1行ずつなので1枚のカードにまとめる。取得に失敗した会社は、その行に注意と公式リンクを出す
  //   シルバーフェリー：定型の文言（通常運航しています／欠航または遅延便があります）
  //   さんふらわあ：自由記述の欄から判定した状態だけ（文章は取り込んでいない）
  //   新日本海フェリー：運航状況のお知らせの件数と日付だけ（題名は取り込んでいない）
  const FERRIES = ["silverferry", "sunflower", "snf"];
  // シルバーフェリーの便ごとの行の色（delay.css の .dl-ship--*。plan.js の SHIP_CLASS と同じ）。代船などは灰色
  const SILVER_SHIP = { シルバープリンセス: "princess", シルバーティアラ: "tiara", シルバーブリーズ: "breeze", シルバーエイト: "eight" };
  // "2026-02-07" / "2026-02-28T09:00:00+09:00" → "2/7" / "2/28"
  const md = (iso) => (iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}` : "");
  function ferryRow(id, svc) {
    let label = "";
    let msg = "";
    let extra = "";
    if (id === "silverferry") {
      label = svc.message;
      if (svc.notice_url) msg = `<a href="${esc(linkOr("silverferry", svc.notice_url, OFFICIAL.silverferry.url))}" target="_blank" rel="noopener">お知らせ</a>`;
      // 欠航・遅延のお知らせから読んだ便ごとの状況（日付・出発港・時刻・船名）。平常時はない
      const list = svc.sailings || [];
      if (list.length) {
        const at = svc.source_time ? `・${md(svc.source_time)} ${hhmm(svc.source_time)} 現在` : "";
        extra = `<details class="dl-sailings"${ui.sailingsOpen ? " open" : ""}>
          <summary>便ごとの状況（${list.length}便${esc(at)}）</summary>
          <ul class="dl-subitems">${list
            .map(
              (s) => `<li class="dl-ship dl-ship--${esc(SILVER_SHIP[s.ship] || "other")}">${badge(s.status, s.label)}
                <span>${esc(md(s.date))} ${esc(s.from)}→${esc(s.to)} ${esc(s.time)}発 ${esc(s.ship)}</span></li>`
            )
            .join("")}</ul>
        </details>`;
      }
    } else if (id === "sunflower") {
      label = svc.label;
      if (svc.source_time) msg = `${esc(md(svc.source_time))} ${esc(hhmm(svc.source_time))} 現在の案内`;
    } else {
      label = svc.notices?.length ? `運航状況のお知らせ ${svc.notices.length}件` : "運航状況のお知らせなし";
      msg = (svc.notices || [])
        .map((n) => `<a href="${esc(linkOr("snf", n.url, SNF_LIST))}" target="_blank" rel="noopener">お知らせ（${esc(md(n.date))}）</a>`)
        .join("　");
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
      <p class="dl-card__note">各社のトップページの運航情報から状態だけを表示しています（シルバーフェリーは、欠航・遅延のお知らせが出ているときだけ便ごとに分けます）。理由や詳しい案内は各社のリンク先へ。新日本海フェリーは、お知らせが出ているかどうかだけです（欠航とは限りません）。</p>
    </section>`;
  }

  // ---------- まとめ（行き先ごと） ----------
  // 各カードのデータから、行き先ごとに「使える手段があるか」をまとめる。手段どうしは代わりになるので、
  // すべて平常／一部に乱れ（平常の手段もある）／すべてに乱れ の3段階にする。集計はページ側だけで行う（Worker は変えていない）
  const worst = (list) =>
    ["suspended", "delay", "normal"].find((st) => list.includes(st)) || (list.includes("offhours") ? "offhours" : "unknown");
  // 手段1つ：id はカードへのリンク先、pick は事業者のデータ → 状態、label は状態 → 表示（なければ共通の表記）
  const means = (name, id, svcId, pick, label = {}) => ({ name, id, svcId, pick, label });
  const ROAD = { suspended: "通行止あり", delay: "規制あり" };
  const JR = { delay: "遅れ・運休" }; // JR北海道の情報は遅れと運休の区別がない
  const SUMMARY = [
    {
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
      name: "札幌 ⇄ 小樽",
      means: [
        means("JR 函館線", "jr", "jr", (s) => s.items?.find((i) => i.id === "hakochise")?.status, JR),
        means("高速おたる号", "chuobus", "chuobus", (s) => s.groups?.find((g) => g.id === "otaru")?.status, { delay: "運休あり" }),
        means("札樽道", "expressway", "expressway", (s) => s.roads?.find((r) => r.id === "sasson")?.status, ROAD),
      ],
    },
    {
      name: "札幌市内（地下鉄）",
      means: ["nanboku", "tozai", "toho"].map((line) =>
        means({ nanboku: "南北線", tozai: "東西線", toho: "東豊線" }[line], "subway", "subway", (s) => s.items?.find((i) => i.id === line)?.status, {
          delay: "遅れあり",
          suspended: "見合わせ",
        })
      ),
    },
    {
      name: "北海道 ⇄ 本州",
      means: [
        means("新千歳空港の便", "airport", "airport", (s) => worst((s.groups || []).map((g) => g.status)), {
          delay: "遅れ・欠航あり",
          suspended: "大規模欠航",
        }),
        means("JR 特急・新幹線", "jr", "jr", (s) =>
          worst((s.items || []).filter((i) => ["express", "shinkansen"].includes(i.id)).map((i) => i.status)),
          JR
        ),
        means("シルバーフェリー", "ferry", "silverferry", (s) => s.status, { delay: "欠航・遅延あり" }),
        means("さんふらわあ", "ferry", "sunflower", (s) => s.status, { delay: "遅れあり", suspended: "欠航あり" }),
        means("新日本海フェリー", "ferry", "snf", (s) => s.status, { delay: "お知らせあり" }),
      ],
    },
  ];
  const CHIP_LABEL = { normal: "平常", delay: "乱れあり", suspended: "運休あり", offhours: "時間外", unknown: "取得できず" };

  function renderSummary(services) {
    const rows = SUMMARY.map((dest) => {
      const chips = dest.means
        .filter((m) => services[m.svcId])
        .map((m) => {
          const svc = services[m.svcId];
          // 取得に失敗している事業者は、前回のデータで判定せず「取得できず」にする
          const st = (svc.ok && m.pick(svc)) || "unknown";
          return { ...m, st };
        });
      if (!chips.length) return "";
      // 時間外・取得できずは判定に使わない
      const known = chips.map((c) => c.st).filter((st) => ["normal", "delay", "suspended"].includes(st));
      let verdict = ["unknown", "判定できません"];
      if (known.length && known.every((st) => st === "normal")) verdict = ["normal", "平常"];
      else if (known.includes("normal")) verdict = ["delay", "一部に乱れ（平常の手段あり）"];
      else if (known.length && known.every((st) => st === "suspended")) verdict = ["suspended", "すべて運休・通行止"];
      else if (known.length) verdict = ["suspended", "すべての手段に乱れ"];
      return `<li class="dl-sum">
        <div class="dl-sum__head"><span class="dl-sum__name">${esc(dest.name)}</span>${badge(verdict[0], verdict[1])}</div>
        <ul class="dl-sum__chips">${chips
          .map(
            (c) => `<li><a class="dl-chip" href="#dl-${esc(c.id)}">${esc(c.name)} ${badge(c.st, c.label[c.st] || CHIP_LABEL[c.st])}</a></li>`
          )
          .join("")}</ul>
      </li>`;
    }).join("");
    return `<section class="dl-card dl-summary" id="dl-summary">
      <h2 class="dl-card__title">行き先ごとのまとめ</h2>
      <ul class="dl-rows">${rows}</ul>
      <p class="dl-card__note">各社の情報を行き先ごとに並べたものです。手段を押すと詳しいカードへ移ります。北都交通は都心線・大谷地線、JR は快速エアポート・函館線（札幌近郊）・特急・新幹線で見ています。</p>
    </section>`;
  }

  const RENDER = {
    jr: renderJr,
    subway: renderSubway,
    airport: renderAirport,
    expressway: renderExpressway,
    chuobus: renderChuobus,
    hokto: renderHokto,
  };

  // Worker に一度もつながらなかったとき（前回の内容もない）に出す公式リンク
  const officialLinks = () =>
    `<section class="dl-card">
      <h2 class="dl-card__title">各社の公式の運行情報</h2>
      <ul class="dl-links">${Object.values(OFFICIAL)
        .map((o) => `<li><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.name)}</a></li>`)
        .join("")}</ul>
    </section>`;

  function render(data) {
    const banners = [];
    if (data.sample) {
      banners.push(`<p class="dl-banner dl-banner--sample">サンプルデータを表示しています（実際の運行状況ではありません）。</p>`);
    } else {
      const age = (Date.now() - Date.parse(data.updated_at)) / 60000;
      if (!(age < STALE_MIN)) {
        banners.push(`<p class="dl-banner">情報の更新が止まっています（最終更新 ${esc(hhmm(data.updated_at))}）。各社の公式情報を確認してください。</p>`);
      }
    }
    $banners.innerHTML = banners.join("");
    // 次回の予定時刻は Worker が入れる（next_update_at）。配信のキャッシュ（60秒）と画面の再取得（60秒）の分だけ少し遅れて反映される
    let next = "";
    if (!data.sample && data.next_update_at) {
      next = Date.parse(data.next_update_at) > Date.now() ? ` ／ 次は ${hhmm(data.next_update_at)}ごろ` : " ／ まもなく更新";
    }
    $updated.textContent = `${hhmm(data.updated_at)} 更新${next}`;
    // まとめは「もし飛行機が止まったら？」（plan.js、描き直さない）より上に置くので、別の入れ物に描く
    $summary.innerHTML = renderSummary(data.services || {});
    // plan.js にシルバーフェリーの今の状況を渡す
    document.dispatchEvent(new CustomEvent("dl:data", { detail: data }));
    $sections.innerHTML =
      Object.entries(RENDER)
        .filter(([id]) => data.services?.[id])
        .map(([id, fn]) => fn(data.services[id]))
        .join("") + renderFerry(data.services || {});
  }

  // Worker は日本国内のネットワークにだけ返し、国外と判定すると 403（error: "region"）を返す（自国の SIM でローミング中・VPN など）
  // そのときは位置情報の許可をもらい、約10km単位に丸めた現在地を付けて取り直す
  let coords = null;
  const endpoint = () => (coords ? `${source}${source.includes("?") ? "&" : "?"}lat=${coords.lat}&lon=${coords.lon}` : source);
  const locateFailed = () => {
    $banners.innerHTML = `<p class="dl-banner">位置情報を使えなかったため、運行情報を表示できません。各社の公式情報を確認してください。</p>`;
  };
  function locate() {
    if (!navigator.geolocation) return locateFailed();
    const round = (v) => Math.round(v * 10) / 10;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        coords = { lat: round(pos.coords.latitude), lon: round(pos.coords.longitude) };
        load();
      },
      locateFailed,
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60 * 1000 }
    );
  }
  async function region() {
    if (coords) {
      $banners.innerHTML = `<p class="dl-banner">現在地が日本国外と判定されたため、運行情報を表示できません。各社の公式情報を確認してください。</p>`;
    } else {
      $banners.innerHTML = `<p class="dl-banner">日本国外のネットワーク（海外の SIM のローミング・VPN など）からの接続と判定されたため、運行情報を表示できません。日本国内にいる場合は、おおよその現在地（約10km単位）で確かめられます。
        <button type="button" class="dl-head__reload dl-banner__btn" data-locate>現在地で確かめる</button></p>`;
      // すでに許可されていれば、ボタンを押さなくても確かめる
      const state = await navigator.permissions?.query({ name: "geolocation" }).then((p) => p.state, () => "");
      if (state === "granted") locate();
    }
    if (!last) {
      $updated.textContent = "表示できません";
      $sections.innerHTML = officialLinks();
    }
  }
  $banners.addEventListener("click", (ev) => ev.target.closest?.("[data-locate]") && locate());

  let last = null;
  async function load() {
    $reload.disabled = true;
    try {
      const res = await fetch(endpoint(), { cache: "no-cache" });
      if (res.status === 403 && (await res.json().catch(() => null))?.error === "region") return await region();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      last = await res.json();
      render(last);
    } catch {
      // 取得できなくても、前に表示した内容は消さない
      $banners.innerHTML = `<p class="dl-banner">運行情報を取得できませんでした${last ? "（前回の内容を表示中）" : ""}。各社の公式情報を確認してください。</p>`;
      if (!last) {
        $updated.textContent = "取得できませんでした";
        $sections.innerHTML = officialLinks();
      }
    } finally {
      $reload.disabled = false;
    }
  }

  $reload.addEventListener("click", load);
  // カードは描き直すたびに作り直すので、イベントは外側の #sections で受ける（toggle は伝わらないので捕捉段階で）
  $sections.addEventListener(
    "toggle",
    (ev) => {
      if (ev.target.matches?.(".dl-flights")) ui.flightsOpen = ev.target.open;
      if (ev.target.matches?.(".dl-sailings")) ui.sailingsOpen = ev.target.open;
    },
    true
  );
  $sections.addEventListener("change", (ev) => {
    if (!ev.target.matches("[data-show-done]")) return;
    ui.showDone = ev.target.checked;
    if (last) render(last);
  });
  // 画面を見ているあいだだけ1分ごとに更新し、戻ってきたときにもすぐ更新する
  setInterval(() => document.visibilityState === "visible" && load(), REFRESH_MS);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && load());
  load();
})();
