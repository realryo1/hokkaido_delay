// 路線図の配線エディタ。手元で index.html?sample&edit を開いたときだけ delay.js が読み込む（公開ページでは読み込まない）
// routemap.js の window.DL_ROUTEMAP をその場で書き換えて描き直し、「保存」で routemap.js を書き直す。
// 地図の線を押すとその手段の行を選び、選んでいるあいだは ← → で列を動かせる
(() => {
  const edit = window.DL_EDIT;
  const data = window.DL_ROUTEMAP;
  if (!edit || !data) return;

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // 手段の一覧（SUMMARY の順）。駅から横に出す枝の行き先（地下鉄など）は置き方を持たないので除く
  const branchIds = () => new Set(data.stations.map((s) => s.branch).filter(Boolean));
  const groups = edit.summary.map((g) => ({ id: g.id, name: g.name, means: g.means.map((m) => m.name) }));

  let selected = null; // 選んでいる線の名前（手段の名前、または extras の名前）
  let dirty = false;
  let fileHandle = null;

  // ---------- 見た目（エディタだけのものなので delay.css には入れない） ----------
  const $style = document.createElement("style");
  $style.textContent = `
    .rme { position: fixed; top: 0; right: 0; z-index: 100; width: min(420px, 100vw); height: 100vh; overflow: auto;
      padding: 12px 14px 40px; background: var(--col-paper); box-shadow: -4px 0 16px rgb(79 69 143 / .2); font-size: .78rem; }
    body.has-rme { padding-right: min(420px, 100vw); }
    .rme h2 { margin: 0 0 6px; font-size: 1rem; }
    .rme h3 { margin: 14px 0 4px; font-size: .85rem; border-bottom: 1px solid var(--col-secondary-light); }
    .rme__bar { position: sticky; top: -12px; z-index: 1; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
      margin: -12px -14px 6px; padding: 10px 14px; background: var(--col-paper); border-bottom: 1px solid var(--col-paper-muted); }
    .rme__status { flex-basis: 100%; opacity: .75; }
    .rme__status.is-dirty { color: var(--col-fan); opacity: 1; font-weight: 700; }
    .rme button { padding: 2px 8px; border: 1px solid var(--col-secondary-light); border-radius: 6px; background: var(--col-paper); cursor: pointer; }
    .rme button:hover { background: var(--col-secondary-lighter); }
    .rme input[type=text] { width: 100%; min-width: 0; padding: 1px 4px; font: inherit; }
    .rme input[type=number] { width: 3.2em; font: inherit; }
    .rme select { max-width: 100%; font: inherit; }
    .rme__row { display: grid; gap: 4px; align-items: center; padding: 4px; border-radius: 6px; }
    .rme__row + .rme__row { border-top: 1px solid var(--col-paper-muted); }
    .rme__row.is-selected { background: var(--col-link-lighter); }
    .rme__st { grid-template-columns: auto auto 1fr auto; }
    .rme__st-more { grid-column: 3 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
    .rme__width { grid-column: 1 / -1; }
    .rme__width input[type=number] { width: 4.5em; }
    .rme__ln { grid-template-columns: 1fr; }
    .rme__ln-head { display: flex; gap: 6px; align-items: center; font-weight: 700; }
    .rme__ln-body { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
    .rme__via { display: inline-flex; flex-wrap: wrap; gap: 2px 8px; }
    .rme__group { margin: 8px 0 2px; font-weight: 700; opacity: .75; }
    .rme__warn { margin: 0; padding-left: 1.2em; color: var(--col-fan); }
    .rme__ok { opacity: .75; }
    .dl-map .dl-track { cursor: pointer; }
  `;
  document.head.append($style);
  // 選んでいる線を地図の上で目立たせる
  const $hl = document.createElement("style");
  document.head.append($hl);

  const $panel = document.createElement("aside");
  $panel.className = "rme";
  document.body.append($panel);
  document.body.classList.add("has-rme");

  // ---------- 配線の操作 ----------
  const names = () => data.stations.map((s) => s.name);
  const at = (name) => names().indexOf(name);
  const placeOf = (name) => data.lines[name] || data.extras.find((x) => x.name === name);
  const maxCol = () => Math.max(0, ...Object.values(data.lines).map((l) => l.col), ...data.extras.map((x) => x.col));

  function changed() {
    dirty = true;
    edit.rerender();
    draw();
  }
  // 駅の名前を変えたら、線・判定の位置の参照も直す
  function renameStation(from, to) {
    for (const l of [...Object.values(data.lines), ...data.extras]) {
      if (l.from === from) l.from = to;
      if (l.to === from) l.to = to;
      if (l.via) l.via = l.via.map((v) => (v === from ? to : v));
    }
    for (const [id, above] of Object.entries(data.captions)) if (above === from) data.captions[id] = to;
  }
  // 途中の駅が変わったら、範囲の外になった停車駅を外す
  function trimVia(l) {
    if (!l.via) return;
    const a = at(l.from);
    const b = l.up ? a : at(l.to);
    l.via = l.via.filter((v) => at(v) > a && at(v) < b);
    if (!l.via.length) delete l.via;
  }

  // 同じ列で重なる線・駅がない参照などを調べる
  function problems() {
    const out = [];
    const all = [...Object.entries(data.lines).map(([name, l]) => ({ name, ...l })), ...data.extras];
    const known = new Set(groups.flatMap((g) => g.means));
    for (const name of Object.keys(data.lines)) if (!known.has(name)) out.push(`「${name}」は SUMMARY にない手段です（描かれません）`);
    const span = (l) => {
      const a = at(l.from);
      // 区間の番号：駅 i と i+1 のあいだが i。上へ出す線は -1（いちばん上の行）
      return l.up ? [-1, -1] : [a, at(l.to) - 1];
    };
    for (const l of all) {
      if (at(l.from) < 0) out.push(`「${l.name}」の始まりの駅「${l.from}」がありません`);
      else if (!l.up && at(l.to) < 0) out.push(`「${l.name}」の終わりの駅「${l.to}」がありません`);
      else if (!l.up && at(l.to) <= at(l.from)) out.push(`「${l.name}」の終わりの駅が始まりより上にあります`);
      else if (l.up && at(l.from) > 0) out.push(`「${l.name}」は上へ消える線ですが、いちばん上の駅から出ていません（途中が描かれません）`);
      if (!(l.col >= 1)) out.push(`「${l.name}」の列が1より小さくなっています`);
    }
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const p = all[i];
        const q = all[j];
        if (p.col !== q.col) continue;
        const [a1, b1] = span(p);
        const [a2, b2] = span(q);
        if (a1 <= b2 && a2 <= b1) out.push(`「${p.name}」と「${q.name}」が ${p.col} 列目で重なっています`);
      }
    }
    // 幅を指定した駅：停まる線（始まり・終わり・途中で停まる線）がカプセルの外に出ていないか
    for (const [i, s] of data.stations.entries()) {
      if (!s.left && !s.right) continue;
      if (s.left && s.right && s.right < s.left) out.push(`駅「${s.name}」の幅の右端が左端より左にあります`);
      for (const l of all) {
        const stops = l.from === s.name || (!l.up && l.to === s.name) || l.via?.includes(s.name);
        if (stops && ((s.left && l.col < s.left) || (s.right && l.col > s.right)))
          out.push(`「${l.name}」は駅「${s.name}」に停まりますが、${l.col} 列目が駅の幅の外です`);
      }
    }
    for (const [id, above] of Object.entries(data.captions)) {
      const k = at(above);
      if (k < 0 || k >= data.stations.length - 1) out.push(`「${groups.find((g) => g.id === id)?.name || id}」の判定の位置「${above}」の下に区間がありません`);
    }
    return out;
  }

  // ---------- 保存 ----------
  // 1行に1つずつ書く（差分を見やすくするため）
  const j = (v) => JSON.stringify(v);
  // 項目の順をそろえる（編集で順が変わっても差分が出ないように）
  const KEYS = ["name", "sub", "branch", "left", "right", "from", "to", "up", "col", "via"];
  const sorted = (o) => Object.fromEntries(KEYS.filter((k) => k in o).map((k) => [k, o[k]]));
  function format() {
    const lines = Object.entries(data.lines).map(([name, l]) => `    ${j(name)}: ${j(sorted(l))}`);
    const caps = Object.entries(data.captions).map(([id, above]) => `    ${j(id)}: ${j(above)}`);
    return `window.DL_ROUTEMAP = {
  "stations": [
${data.stations.map((s) => `    ${j(sorted(s))}`).join(",\n")}
  ],
  "lines": {
${lines.join(",\n")}
  },
  "extras": [
${data.extras.map((x) => `    ${j(sorted(x))}`).join(",\n")}
  ],
  "captions": {
${caps.join(",\n")}
  },
  "topNote": ${j(data.topNote || "")}
};
`;
  }
  // routemap.js の先頭のコメントはそのまま残す
  async function fileText() {
    let head = "";
    try {
      const text = await (await fetch("routemap.js", { cache: "no-store" })).text();
      head = text.slice(0, Math.max(0, text.indexOf("window.DL_ROUTEMAP")));
    } catch {}
    return head + format();
  }
  function status(text) {
    const $s = $panel.querySelector(".rme__status");
    $s.textContent = text;
    $s.classList.toggle("is-dirty", dirty);
  }
  async function save() {
    const text = await fileText();
    if (window.showSaveFilePicker) {
      try {
        fileHandle ??= await window.showSaveFilePicker({
          suggestedName: "routemap.js",
          types: [{ description: "JavaScript", accept: { "text/javascript": [".js"] } }],
        });
        const w = await fileHandle.createWritable();
        await w.write(text);
        await w.close();
        dirty = false;
        status(`保存しました（${fileHandle.name}）`);
        return;
      } catch (e) {
        if (e.name === "AbortError") return;
        fileHandle = null;
      }
    }
    // ファイルに直接書けないブラウザ：ダウンロードして website/routemap.js に置き換えてもらう
    const $a = document.createElement("a");
    $a.href = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
    $a.download = "routemap.js";
    $a.click();
    URL.revokeObjectURL($a.href);
    dirty = false;
    status("ダウンロードしました。website/routemap.js と置き換えてください");
  }
  async function copy() {
    await navigator.clipboard.writeText(await fileText());
    status("routemap.js の中身をコピーしました");
  }

  // ---------- パネル ----------
  const opt = (value, label, cur) => `<option value="${esc(value)}"${value === cur ? " selected" : ""}>${esc(label)}</option>`;
  const stationOpts = (cur, extra = "") => extra + names().map((n) => opt(n, n, cur)).join("");

  function lineRow(name, l, isExtra) {
    const a = at(l.from);
    const b = l.up ? a : at(l.to);
    const mids = data.stations.slice(a + 1, b > a ? b : a + 1).map((s) => s.name);
    const via = mids.length
      ? `<span class="rme__via">停まる：${mids
          .map((m) => `<label><input type="checkbox" data-act="via" data-via="${esc(m)}"${l.via?.includes(m) ? " checked" : ""}>${esc(m)}</label>`)
          .join("")}</span>`
      : "";
    return `<div class="rme__row rme__ln${selected === name ? " is-selected" : ""}" data-name="${esc(name)}" data-extra="${isExtra ? 1 : ""}">
      <div class="rme__ln-head">
        ${isExtra ? `<input type="text" data-act="xname" value="${esc(name)}">` : `<span>${esc(name)}</span>`}
        ${isExtra ? `<button type="button" data-act="xdel" title="消す">×</button>` : `<button type="button" data-act="unplace" title="路線図に描かない">外す</button>`}
      </div>
      <div class="rme__ln-body">
        <select data-act="from">${stationOpts(l.from)}</select>
        →
        <select data-act="to">${isExtra ? "" : opt("↑", "↑ 上へ消える", l.up ? "↑" : "")}${stationOpts(l.up ? "" : l.to)}</select>
        列 <button type="button" data-act="left">◀</button><input type="number" min="1" data-act="col" value="${esc(l.col)}"><button type="button" data-act="right">▶</button>
        ${via}
      </div>
    </div>`;
  }

  function draw() {
    const branches = branchIds();
    const stations = data.stations
      .map(
        (s, i) => `<div class="rme__row rme__st" data-i="${i}">
          <button type="button" data-act="up" title="上へ"${i === 0 ? " disabled" : ""}>▲</button>
          <button type="button" data-act="down" title="下へ"${i === data.stations.length - 1 ? " disabled" : ""}>▼</button>
          <input type="text" data-act="name" value="${esc(s.name)}" title="駅名">
          <button type="button" data-act="sdel" title="消す">×</button>
          <div class="rme__st-more">
            <input type="text" data-act="sub" value="${esc(s.sub || "")}" placeholder="駅名の下の小さい説明" title="駅名の下の小さい説明">
            <select data-act="branch" title="横に出す短い線">${opt("", "枝なし", s.branch || "")}${groups.map((g) => opt(g.id, `枝：${g.name}`, s.branch || "")).join("")}</select>
            <span class="rme__width" title="駅のカプセルの左端と右端の列。空欄なら停まる線に合わせる">幅：列
              <input type="number" min="1" data-act="left" value="${esc(s.left || "")}" placeholder="自動">〜<input type="number" min="1" data-act="right" value="${esc(s.right || "")}" placeholder="自動">
            </span>
          </div>
        </div>`
      )
      .join("");
    const lines = groups
      .filter((g) => !branches.has(g.id))
      .map((g) => {
        const rows = g.means
          .map((name) =>
            data.lines[name]
              ? lineRow(name, data.lines[name], false)
              : `<div class="rme__row rme__ln" data-name="${esc(name)}"><div class="rme__ln-head"><span style="opacity:.6">${esc(name)}</span><button type="button" data-act="place">描く</button></div></div>`
          )
          .join("");
        return `<p class="rme__group">${esc(g.name)}</p>${rows}`;
      })
      .join("");
    const extras = data.extras.map((x) => lineRow(x.name, x, true)).join("");
    const caps = groups
      .filter((g) => !branches.has(g.id))
      .map(
        (g) => `<div class="rme__row" style="grid-template-columns: 1fr 1fr">
          <span>${esc(g.name)}</span>
          <select data-act="caption" data-group="${esc(g.id)}">${opt("", "出さない", data.captions[g.id] || "")}${data.stations
            .slice(0, -1)
            .map((s, i) => opt(s.name, `${s.name} → ${data.stations[i + 1].name}`, data.captions[g.id] || ""))
            .join("")}</select>
        </div>`
      )
      .join("");
    const warn = problems();
    const prevStatus = $panel.querySelector(".rme__status")?.textContent;
    $panel.innerHTML = `
      <div class="rme__bar">
        <h2>配線エディタ</h2>
        <button type="button" data-act="save">保存</button>
        <button type="button" data-act="copy">コピー</button>
        <button type="button" data-act="reload">保存した状態に戻す</button>
        <p class="rme__status">${esc(dirty ? "未保存の変更があります" : prevStatus || "地図の線を押すと選べます（選んでいるあいだは ← → で列を動かせます）")}</p>
      </div>
      <h3>気になるところ</h3>
      ${warn.length ? `<ul class="rme__warn">${warn.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : `<p class="rme__ok">ありません</p>`}
      <h3>駅（上から下へ）</h3>
      ${stations}
      <p><button type="button" data-act="sadd">駅を足す</button></p>
      <h3>線</h3>
      ${lines}
      <p class="rme__group">運行情報のない線（灰色）</p>
      ${extras}
      <p><button type="button" data-act="xadd">灰色の線を足す</button></p>
      <h3>判定を出す区間</h3>
      ${caps}
      <h3>上へ消える線の行の説明</h3>
      <input type="text" data-act="topnote" value="${esc(data.topNote || "")}">
    `;
    $panel.querySelector(".rme__status").classList.toggle("is-dirty", dirty);
    $hl.textContent = selected
      ? `.dl-map [data-line="${CSS.escape(selected)}"] .dl-track__line { box-shadow: 0 0 0 3px var(--col-link-light); }`
      : "";
  }

  // ---------- 入力 ----------
  const rowLine = ($row) => {
    const name = $row.dataset.name;
    return $row.dataset.extra ? data.extras.find((x) => x.name === name) : data.lines[name];
  };
  $panel.addEventListener("click", async (ev) => {
    const $b = ev.target.closest("button[data-act]");
    const $row = ev.target.closest(".rme__row");
    if ($row?.dataset.name && !ev.target.closest("input, select, button")) {
      selected = $row.dataset.name;
      draw();
      return;
    }
    if (!$b) return;
    const act = $b.dataset.act;
    if (act === "save") return save();
    if (act === "copy") return copy();
    if (act === "reload") {
      if (!dirty || confirm("保存していない変更を捨てますか？")) {
        dirty = false;
        location.reload();
      }
      return;
    }
    const i = Number($row?.dataset.i);
    if (act === "up" || act === "down") {
      const k = act === "up" ? i - 1 : i + 1;
      [data.stations[i], data.stations[k]] = [data.stations[k], data.stations[i]];
      for (const l of [...Object.values(data.lines), ...data.extras]) trimVia(l);
    } else if (act === "sdel") {
      if (!confirm(`駅「${data.stations[i].name}」を消しますか？`)) return;
      data.stations.splice(i, 1);
    } else if (act === "sadd") {
      let n = 1;
      while (names().includes(`新しい駅${n}`)) n++;
      data.stations.push({ name: `新しい駅${n}` });
    } else if (act === "place") {
      const name = $row.dataset.name;
      data.lines[name] = { from: names()[0], to: names()[1], col: maxCol() + 1 };
      selected = name;
    } else if (act === "unplace") {
      delete data.lines[$row.dataset.name];
    } else if (act === "xadd") {
      let n = 1;
      while (data.extras.some((x) => x.name === `灰色の線${n}`)) n++;
      data.extras.push({ name: `灰色の線${n}`, from: names()[0], to: names()[1], col: maxCol() + 1 });
      selected = `灰色の線${n}`;
    } else if (act === "xdel") {
      data.extras = data.extras.filter((x) => x.name !== $row.dataset.name);
    } else if (act === "left" || act === "right") {
      const l = rowLine($row);
      l.col = Math.max(1, l.col + (act === "left" ? -1 : 1));
      selected = $row.dataset.name;
    } else return;
    changed();
  });
  $panel.addEventListener("change", (ev) => {
    const $in = ev.target;
    const act = $in.dataset.act;
    const $row = $in.closest(".rme__row");
    const i = Number($row?.dataset.i);
    const l = $row?.dataset.name && rowLine($row);
    if (act === "name") {
      const to = $in.value.trim();
      if (!to || names().includes(to)) return draw();
      renameStation(data.stations[i].name, to);
      data.stations[i].name = to;
    } else if (act === "sub") {
      if ($in.value.trim()) data.stations[i].sub = $in.value.trim();
      else delete data.stations[i].sub;
    } else if (act === "branch") {
      if ($in.value) data.stations[i].branch = $in.value;
      else delete data.stations[i].branch;
    } else if (act === "left" || act === "right") {
      // 空欄（0 以下）なら自動に戻す
      const v = Math.round(Number($in.value));
      if (v >= 1) data.stations[i][act] = v;
      else delete data.stations[i][act];
    } else if (act === "from") {
      l.from = $in.value;
      trimVia(l);
    } else if (act === "to") {
      if ($in.value === "↑") {
        l.up = true;
        delete l.to;
      } else {
        delete l.up;
        l.to = $in.value;
      }
      trimVia(l);
    } else if (act === "col") {
      l.col = Math.max(1, Math.round(Number($in.value)) || 1);
    } else if (act === "via") {
      const v = new Set(l.via || []);
      if ($in.checked) v.add($in.dataset.via);
      else v.delete($in.dataset.via);
      l.via = names().filter((n) => v.has(n));
      if (!l.via.length) delete l.via;
    } else if (act === "xname") {
      const to = $in.value.trim();
      if (!to || data.extras.some((x) => x.name === to)) return draw();
      l.name = to;
      selected = to;
    } else if (act === "caption") {
      if ($in.value) data.captions[$in.dataset.group] = $in.value;
      else delete data.captions[$in.dataset.group];
    } else if (act === "topnote") {
      data.topNote = $in.value;
    } else return;
    changed();
  });

  // 地図の線を押すと、カードへ移る代わりにその線を選ぶ（delay.js のリンクの処理より先に止める）
  document.addEventListener(
    "click",
    (ev) => {
      const $t = ev.target.closest?.(".dl-map [data-line]");
      if (!$t) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      selected = $t.dataset.line;
      draw();
      $panel.querySelector(".rme__ln.is-selected")?.scrollIntoView({ block: "nearest" });
    },
    true
  );
  // 選んでいる線を ← → で動かす（入力欄にいるときは動かさない）
  document.addEventListener("keydown", (ev) => {
    if (!selected || ev.target.closest?.("input, select, textarea")) return;
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    const l = placeOf(selected);
    if (!l) return;
    ev.preventDefault();
    l.col = Math.max(1, l.col + (ev.key === "ArrowLeft" ? -1 : 1));
    changed();
  });
  window.addEventListener("beforeunload", (ev) => {
    if (dirty) ev.preventDefault();
  });

  draw();
})();
