// 画面の並べ方の操作：2カラムの持ち手、狭い画面のタブ、まとめの線からカードへ移るリンク（main.js が initLayout を呼ぶ）
import { initTablist, selectTab } from "./tabs.js";
import { scrollBehavior } from "./util.js";
import { initTouchPan } from "./touchpan.js";

// 2カラムの持ち手（delay.css の .dl-split）：ドラッグ（ダブルクリックで半々、← → キーでも動く）で運行状況のパネルの幅を変え、この端末に覚える
function initSplit() {
  const $split = document.getElementById("split");
  if (!$split) return;
  const $main = $split.parentElement;
  const KEY = "hokkaido-delay-board-w";
  const MIN_BOARD = 300;
  const MIN_SIDE = 260;
  // .dl の位置と幅はドラッグ中は変わらないので押した時に1回だけ測る
  let rect = null;
  const gap = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gap")) || 10;
  const setW = (pct, save) => {
    const total = rect?.width || $main.clientWidth || window.innerWidth;
    const w = Math.min(100 - ((MIN_SIDE + gap()) / total) * 100, Math.max((MIN_BOARD / total) * 100, pct));
    $main.style.setProperty("--board-w", `${w}%`);
    $split.setAttribute("aria-valuenow", String(Math.round(w)));
    if (!save) return;
    try {
      localStorage.setItem(KEY, String(Math.round(w * 10) / 10));
    } catch {
      // 保存できなくても、幅は変えられる
    }
  };
  let saved = NaN;
  try {
    saved = parseFloat(localStorage.getItem(KEY));
  } catch {
    saved = NaN;
  }
  setW(Number.isFinite(saved) ? saved : 50, false);
  // 持ち手の列（幅は --gap）の中央を指の位置に合わせる
  const pctAt = (x) => {
    const r = rect ?? $main.getBoundingClientRect();
    return ((x - r.left - gap() / 2) / r.width) * 100;
  };
  // 幅の変更は1フレームに1回だけにまとめる
  let moveX = 0;
  let moveRaf = 0;
  $split.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    rect = $main.getBoundingClientRect();
    $split.setPointerCapture(ev.pointerId);
    $split.classList.add("is-dragging");
  });
  $split.addEventListener("pointermove", (ev) => {
    if (!$split.hasPointerCapture(ev.pointerId)) return;
    moveX = ev.clientX;
    if (!moveRaf)
      moveRaf = requestAnimationFrame(() => {
        moveRaf = 0;
        setW(pctAt(moveX), false);
      });
  });
  const end = (ev) => {
    if (!$split.hasPointerCapture(ev.pointerId)) return;
    cancelAnimationFrame(moveRaf);
    moveRaf = 0;
    $split.releasePointerCapture(ev.pointerId);
    $split.classList.remove("is-dragging");
    setW(pctAt(ev.clientX), true);
    rect = null;
  };
  $split.addEventListener("pointerup", end);
  $split.addEventListener("pointercancel", end);
  $split.addEventListener("dblclick", () => setW(50, true));
  // 画面の幅が変わったら（端末を回したときなど）、下限をかけ直す
  window.addEventListener("resize", () => setW(parseFloat($main.style.getPropertyValue("--board-w")), false));
  $split.addEventListener("keydown", (ev) => {
    const step = { ArrowLeft: -2, ArrowRight: 2 }[ev.key];
    if (!step) return;
    ev.preventDefault();
    setW(parseFloat($main.style.getPropertyValue("--board-w")) + step, true);
  });
}

// 狭い画面のタブ（delay.css の .dl-tabs）。2カラムのときはバーごと隠すだけで、.is-active は見た目に影響しない
// 選んでいるボタンの下にガラスの板（.dl-tabs__glider）を敷き、押したりドラッグしたりすると指に追従する
function initTabs() {
  const $list = document.querySelector(".dl-tabs");
  const $tabs = [...$list.querySelectorAll("[data-tab]")];
  const $cols = [...document.querySelectorAll("[data-col]")];
  const $glider = document.createElement("span");
  $glider.className = "dl-tabs__glider";
  $glider.setAttribute("aria-hidden", "true");
  $list.prepend($glider);
  $list.style.setProperty("--n", $tabs.length);

  const showCol = (name) => {
    const i = Math.max(0, $tabs.findIndex(($t) => $t.dataset.tab === name));
    selectTab($list, $tabs[i]);
    $list.style.setProperty("--i", i);
    for (const $c of $cols) $c.classList.toggle("is-active", $c.dataset.col === name);
  };
  showCol($tabs.find(($t) => $t.getAttribute("aria-selected") === "true")?.dataset.tab || $tabs[0].dataset.tab);
  initTablist($list, ($t) => showCol($t.dataset.tab));

  // ポインター操作（タップ・ドラッグ）でガラス板を動かす
  let drag = null;
  let suppressUntil = 0;
  const indexAt = (x) => Math.max(0, Math.min($tabs.length - 1, Math.floor((x - drag.start) / drag.w)));
  const hoverAt = (i) => $tabs.forEach(($t, k) => $t.classList.toggle("is-hover", k === i));
  const end = (ev) => {
    if (!drag) return;
    const $target = ev.type === "pointerup" ? $tabs[indexAt(ev.clientX)] : null;
    $tabs.forEach(($t) => $t.classList.remove("is-hover"));
    drag = null;
    $list.classList.remove("is-pressed", "is-dragging");
    $glider.style.transform = "";
    if (!$target) return;
    suppressUntil = performance.now() + 500;
    showCol($target.dataset.tab);
  };
  $list.addEventListener("pointerdown", (ev) => {
    if (ev.button || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) return;
    const r = $list.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle($list).paddingLeft);
    drag = { id: ev.pointerId, x0: ev.clientX, start: r.left + pad, w: (r.width - pad * 2) / $tabs.length, moved: false };
    $list.setPointerCapture(ev.pointerId);
    $list.classList.add("is-pressed");
    const i = indexAt(ev.clientX);
    $glider.style.transform = `translateX(${i * drag.w}px)`;
    hoverAt(i);
  });
  $list.addEventListener("pointermove", (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.abs(ev.clientX - drag.x0) < 6) return;
      drag.moved = true;
      $list.classList.add("is-dragging");
    }
    $glider.style.transform = `translateX(${Math.max(0, Math.min(drag.w * ($tabs.length - 1), ev.clientX - drag.start - drag.w / 2))}px)`;
    hoverAt(indexAt(ev.clientX));
  });
  for (const type of ["pointerup", "pointercancel"]) $list.addEventListener(type, end);
  $list.addEventListener(
    "click",
    (ev) => {
      if (ev.isTrusted && performance.now() < suppressUntil) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
      }
    },
    true
  );
  for (const $t of $tabs) $t.addEventListener("click", () => showCol($t.dataset.tab));

  // 上に戻るボタン：押したら先頭へスクロールする
  document.getElementById("toTop")?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: scrollBehavior() }));

  // まとめの線（#dl-jr など）が指すカードの列を出してから移る（隠れた列の中へはリンクで移れないため）
  document.addEventListener("click", (ev) => {
    const $a = ev.target.closest?.('a[href^="#dl-"]');
    const $target = $a && document.getElementById($a.getAttribute("href").slice(1));
    const $col = $target?.closest("[data-col]");
    if (!$col) return;
    ev.preventDefault();
    showCol($col.dataset.col);
    $target.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
  });
}

export function initLayout() {
  initSplit();
  initTabs();
  // 2カラムのタッチ：左右の列を別々の指で同時にスクロールできるようにする（1列のときはページ全体の標準のスクロール）
  const twoCol = matchMedia("(min-width: 641px)");
  for (const $col of [document.querySelector(".dl-board"), document.getElementById("right")]) initTouchPan($col, () => twoCol.matches);
}
