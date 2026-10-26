// もし飛行機が止まったら？：フェリーで本州へ渡る経路の案内（札幌・新千歳・小樽にいる場合に分ける）
// 時刻表と所要時間は公式の案内（index.html の出典）から手で写したもの。事業者サイトへは取りに行かない。
// 運行情報（delay.js が取得した JSON）が届いたら、フェリー・バスの今の状況を重ねる。
(() => {
  // シルバーフェリー 苫小牧発 → 八戸着（公式「航路・時刻」2026-10-26 確認）。定期検査・代船の期間は変わることがある
  // shuttle：八戸港フェリーターミナル → 本八戸駅のシャトルバス（南部バス）。朝の2本だけ
  const SILVER = [
    { time: "05:00", ship: "シルバーブリーズ", arrive: "13:30", nextDay: false, shuttle: null },
    { time: "09:30", ship: "シルバーエイト", arrive: "18:00", nextDay: false, shuttle: null },
    { time: "21:15", ship: "シルバープリンセス", arrive: "04:45", nextDay: true, shuttle: "05:40発 → 本八戸駅 05:55着" },
    { time: "23:59", ship: "シルバーティアラ", arrive: "07:30", nextDay: true, shuttle: "08:05発 → 本八戸駅 08:25着" },
  ];
  // 高速とまこまい号（北海道中央バス）のフェリーターミナル行き（2026年7月1日更新の夏ダイヤ）。
  // 苫小牧駅前からも乗れる（中央バスの時刻表の注意書き※1）。冬ダイヤで変わることがある
  const BUSES = [
    { sapporo: "15:00", station: "16:41", terminal: "16:55" },
    { sapporo: "16:00", station: "17:41", terminal: "17:55" },
    { sapporo: "17:50", station: "19:31", terminal: "19:45" },
    { sapporo: "20:15", station: "21:56", terminal: "22:10" },
    { sapporo: "21:15", station: "22:56", terminal: "23:10" },
  ];
  // 新日本海フェリー 小樽発（公式「時刻表・運航スケジュール」2026-10-26 確認）。days は運航する曜日（0 = 日曜）。
  // 運航日が変則になることがある。bus：小樽駅前・小樽築港駅北口からの連絡バス（中央バス ぱるて築港線、公式「のりば・アクセス」）
  const SNF = [
    {
      time: "16:45",
      to: "新潟",
      arrive: "09:15",
      days: [1, 2, 3, 4, 5, 6],
      bus: "小樽駅前 15:29発（約30分）／小樽築港駅北口 15:52発（平日）・15:47発（土日祝）",
    },
    { time: "23:30", to: "舞鶴", arrive: "21:15", days: [0, 1, 2, 3, 4, 5, 6], bus: "小樽駅前 21:00発（約30分）／小樽築港駅北口 21:20発" },
  ];

  // 行の色（delay.css の .dl-ship--*）。シルバーフェリーは船ごと、新日本海フェリーは船が日によって違うので行き先ごと
  const SHIP_CLASS = {
    シルバープリンセス: "princess",
    シルバーティアラ: "tiara",
    シルバーブリーズ: "breeze",
    シルバーエイト: "eight",
    新潟: "snf-niigata",
    舞鶴: "snf-maizuru",
  };

  // 新千歳空港 → 苫小牧西港フェリーターミナルの目安（分）
  const JR_MIN = 30; // JR 新千歳空港 →（南千歳で乗り継ぎ）→ 苫小牧（新千歳空港の公式「約30分」）
  const WAIT_MIN = 30; // 列車の待ち時間の余裕（JR の時刻は見ていないため）
  const TAXI_MIN = 15; // 苫小牧駅 → フェリーターミナル タクシー（シルバーフェリー公式「約15分」）
  const SILVER_BEFORE = 60; // 乗船開始は出港の約1時間前（シルバーフェリー公式 FAQ）。それまでにターミナルに着く
  const CHITOSE_TRAVEL = JR_MIN + WAIT_MIN + TAXI_MIN;
  const OTARU_TAXI = 10; // 小樽駅 → 小樽フェリーターミナル タクシー（新日本海フェリー公式「約10分」）
  const SNF_BEFORE = 60; // 出港の60分前までにターミナルへ（新日本海フェリー公式。繁忙期は90分前）
  const SHOW = 2; // 表示する便の数（直近の2便）

  const $time = document.getElementById("plan-time");
  const $now = document.getElementById("plan-now");
  const $out = {
    sapporoSilver: document.getElementById("plan-sapporo-silver"),
    sapporoSnf: document.getElementById("plan-sapporo-snf"),
    chitose: document.getElementById("plan-chitose"),
    otaru: document.getElementById("plan-otaru"),
  };
  const $places = [...document.querySelectorAll(".dl-plan__place")];
  if (!$time || !$out.chitose) return;

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const pad = (n) => String(n).padStart(2, "0");
  const toMin = (hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);
  const fmt = (min) => {
    const m = ((min % 1440) + 1440) % 1440;
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  };
  // 日本時間の「今日」の日付と、0時からの分
  const jstNow = () => {
    const t = new Date(Date.now() + 9 * 3600 * 1000);
    return { date: t.toISOString().slice(0, 10), min: t.getUTCHours() * 60 + t.getUTCMinutes() };
  };
  const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();
  const md = (iso) => `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}`;
  const span = (min) => (min >= 60 ? `${Math.floor(min / 60)}時間${min % 60 ? `${min % 60}分` : ""}` : `${min}分`);
  const DAY = ["今日", "明日", "明後日", "3日後"];
  const badge = (status, label) => `<span class="dl-badge dl-badge--${esc(status)}">${esc(label)}</span>`;

  // ---------- 運行情報（delay.js から） ----------
  let silver = null; // services.silverferry
  let snf = null; // services.snf
  let tomakomai = null; // services.chuobus.groups の tomakomai

  // シルバーフェリーの便の今の状況。お知らせから読んだ便ごとの状況があればそれを、なければトップの状態を使う
  function silverBadge(s) {
    if (!silver) return "";
    if (!silver.ok) return badge("unknown", "状況を取得できず");
    const hit = (silver.sailings || []).find((x) => x.date === s.date && x.from === "苫小牧" && x.time === s.time);
    if (hit) return badge(hit.status, hit.label);
    if (silver.status === "normal") return badge("normal", "通常運航");
    return badge("delay", "欠航・遅延あり（公式で確認）");
  }
  // 新日本海フェリーは運航状況のお知らせが出ているかどうかだけ分かる
  function snfBadge() {
    if (!snf) return "";
    if (!snf.ok) return badge("unknown", "状況を取得できず");
    return snf.status === "normal" ? badge("normal", "お知らせなし") : badge("delay", "運航のお知らせあり（公式で確認）");
  }
  // 高速とまこまい号の運休の有無（中央バスの RSS。どの便かまでは見ない）
  function busBadge() {
    if (!tomakomai) return "";
    if (!tomakomai.ok) return ` ${badge("unknown", "運休情報を取得できず")}`;
    return tomakomai.status === "normal" ? ` ${badge("normal", "運休情報なし")}` : ` ${badge("delay", "運休あり（中央バスで確認）")}`;
  }

  // ---------- 計算 ----------
  // base（出る時刻、今日の0時からの分）より後に出港する便を、今日から3日分の中から時刻順に SHOW 便
  function upcoming(list, base, today) {
    return [0, 1, 2]
      .flatMap((d) => {
        const date = addDays(today, d);
        return list
          .filter((s) => !s.days || s.days.includes(weekday(date)))
          .map((s) => ({ ...s, d, date, dep: d * 1440 + toMin(s.time) }));
      })
      .filter((s) => s.dep > base)
      .sort((a, b) => a.dep - b.dep)
      .slice(0, SHOW);
  }
  // 乗船開始までにターミナルに着く、いちばん遅い高速とまこまい号（出港の3時間前より前に着く便は出さない）。
  // from：何時以降に乗れるか（今日の0時からの分）。key：乗る停留所（sapporo＝札幌駅前、station＝苫小牧駅前）
  function lastBus(s, from, key) {
    return BUSES.filter((b) => {
      const t = s.d * 1440 + toMin(b.terminal);
      return t <= s.dep - SILVER_BEFORE && t >= s.dep - 180 && s.d * 1440 + toMin(b[key]) >= from;
    }).pop();
  }
  // 会社名と行き先（八戸）は上の枠のタイトルにあるので、船の名前だけ
  const silverTitle = (s) => `${DAY[s.d]}（${md(s.date)}）${s.time}発 ${s.ship}`;
  const silverArrive = (s) =>
    `八戸港 ${DAY[s.d + (s.nextDay ? 1 : 0)]} ${s.arrive}着／${s.shuttle ? `シャトルバス ${s.shuttle}` : "八戸駅へはタクシー約20分"}`;
  const snfTitle = (s) => `${DAY[s.d]}（${md(s.date)}）${s.time}発 新日本海フェリー（${s.to}行き）`;
  const snfArrive = (s) => `${s.to}港 ${DAY[s.d + 1]} ${s.arrive}着`;

  // lines は HTML（呼ぶ側でエスケープ済み）
  function row({ title, live, lines, late, ship }) {
    return `<li class="dl-row dl-plan__row dl-ship--${esc(SHIP_CLASS[ship] || "other")}${late ? " is-late" : ""}">
      <span class="dl-row__name">${esc(title)}</span>${live || ""}
      ${lines
        .filter(Boolean)
        .map((l) => `<span class="dl-row__msg">${l}</span>`)
        .join("")}
    </li>`;
  }
  const verdict = (leaveBy, base, where) =>
    leaveBy >= base
      ? `<strong>間に合う目安</strong>：${esc(where)}を ${esc(fmt(leaveBy))} までに出発（あと ${esc(span(leaveBy - base))}）`
      : `<strong>間に合わない目安</strong>：${esc(where)}を ${esc(fmt(leaveBy))} までに出る必要があります`;
  // 深夜・早朝は JR が走っていない時間帯がある（JR の時刻は見ていないので、幅を広めにとって注意だけ出す）
  const nightNote = (leaveBy) => {
    const m = ((leaveBy % 1440) + 1440) % 1440;
    return m >= 23 * 60 || m < 6 * 60
      ? `<span class="dl-plan__night">深夜・早朝は JR が走っていない時間帯があります。始発・終電を確かめるか、タクシーなどを考えてください。</span>`
      : "";
  };

  function renderSapporo(base, today) {
    const silverRows = upcoming(SILVER, base, today).map((s) => {
      const bus = lastBus(s, base, "sapporo");
      return row({
        title: silverTitle(s),
        ship: s.ship,
        live: silverBadge(s),
        late: !bus,
        lines: [
          bus
            ? `<strong>間に合う目安</strong>：札幌駅前 ${esc(bus.sapporo)}発の高速とまこまい号（フェリーターミナル ${esc(bus.terminal)}着）${busBadge()}`
            : "高速とまこまい号では間に合いません（JR で苫小牧駅へ行き、タクシーなど）",
          esc(silverArrive(s)),
        ],
      });
    });
    // 札幌〜小樽の所要時間は公式の数字がないので、計算はせずに小樽からの行き方を示す
    const snfRows = upcoming(SNF, base, today).map((s) =>
      row({
        title: snfTitle(s),
        ship: s.to,
        live: snfBadge(),
        lines: [`小樽へ移動し、連絡バス（${esc(s.bus)}）かタクシーでターミナルへ。出港の60分前まで`, esc(snfArrive(s))],
      })
    );
    // フェリーごとに「行き方 → 便」の順に並べる（index.html でそれぞれの行き方の下に入れ物がある）
    $out.sapporoSilver.innerHTML = `<ul class="dl-rows">${silverRows.join("")}</ul>`;
    $out.sapporoSnf.innerHTML = `<ul class="dl-rows">${snfRows.join("")}</ul>`;
  }

  function renderChitose(base, today) {
    const rows = upcoming(SILVER, base, today).map((s) => {
      const leaveBy = s.dep - SILVER_BEFORE - CHITOSE_TRAVEL; // 新千歳空港をこの時刻までに出れば間に合う
      const ok = leaveBy >= base;
      // 苫小牧駅に着いてから乗れるバス（JR と待ち時間の分だけ後）
      const bus = lastBus(s, base + JR_MIN + WAIT_MIN, "station");
      return row({
        title: silverTitle(s),
        ship: s.ship,
        live: silverBadge(s),
        late: !ok,
        lines: [
          verdict(leaveBy, base, "新千歳空港"),
          bus
            ? `バスなら：高速とまこまい号 苫小牧駅前 ${esc(bus.station)}発 → フェリーターミナル ${esc(bus.terminal)}着${busBadge()}`
            : "",
          ok ? nightNote(leaveBy) : "",
          esc(silverArrive(s)),
        ],
      });
    });
    $out.chitose.innerHTML = `<ul class="dl-rows">${rows.join("")}</ul>`;
  }

  function renderOtaru(base, today) {
    const rows = upcoming(SNF, base, today).map((s) => {
      const leaveBy = s.dep - SNF_BEFORE - OTARU_TAXI; // 小樽駅をこの時刻までにタクシーで出れば間に合う
      return row({
        title: snfTitle(s),
        ship: s.to,
        live: snfBadge(),
        late: leaveBy < base,
        lines: [verdict(leaveBy, base, "小樽駅（タクシー）"), `連絡バス：${esc(s.bus)}`, esc(snfArrive(s))],
      });
    });
    $out.otaru.innerHTML = `<ul class="dl-rows">${rows.join("")}</ul>`;
  }

  function render() {
    const now = jstNow();
    const base = $time.value ? toMin($time.value) : now.min;
    if (!$time.value) $time.value = fmt(base);
    renderSapporo(base, now.date);
    renderChitose(base, now.date);
    renderOtaru(base, now.date);
  }

  // ---------- 開閉（閉じた場所をこの端末に覚える） ----------
  // 場所ごとのチップは details。開くとチップが広がって中身が出る（delay.css の .dl-plan__place）
  const KEY = "hokkaido-delay-plan-closed";
  let closed = [];
  try {
    closed = JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    closed = [];
  }
  for (const $p of $places) {
    $p.open = !closed.includes($p.dataset.plan);
    $p.addEventListener("toggle", () => {
      const id = $p.dataset.plan;
      closed = $p.open ? closed.filter((x) => x !== id) : [...new Set([...closed, id])];
      try {
        localStorage.setItem(KEY, JSON.stringify(closed));
      } catch {
        // 保存できなくても、開閉はできる
      }
    });
  }

  // 別の場所の欄へ移るボタン（札幌の欄の「小樽・小樽築港・ウイングベイからの行き方」）。閉じていれば開いてからスクロールする
  for (const $b of document.querySelectorAll("[data-open-plan]")) {
    $b.addEventListener("click", () => {
      const $p = $places.find((x) => x.dataset.plan === $b.dataset.openPlan);
      if (!$p) return;
      $p.open = true;
      $p.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  $time.addEventListener("input", render);
  $now?.addEventListener("click", () => {
    $time.value = "";
    render();
  });
  // delay.js が運行情報を取得するたびに知らせてくる
  document.addEventListener("dl:data", (ev) => {
    const sv = ev.detail?.services || {};
    silver = sv.silverferry || null;
    snf = sv.snf || null;
    const g = sv.chuobus?.groups?.find((x) => x.id === "tomakomai");
    tomakomai = sv.chuobus ? { ok: sv.chuobus.ok && !!g, status: g?.status } : null;
    render();
  });
  render();
})();
