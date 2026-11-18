// 2カラムのタッチ：左右の列を、別々の指で同時にスクロールできるようにする（layout.js が列ごとに呼ぶ）
// ブラウザ標準のスクロールは同時に1か所しか動かず、左右に1本ずつ指を置くとピンチ扱いになってどちらも動かない。
// そこで2カラムのときは列を touch-action: none にして（delay.css）、列の中で始まった指1本の動きをここで受けて動かす（慣性も自前）。
// ページ全体（window）は動かさない（iOS で JS から動かすと震えることがあるため、列はどちらも自分の枠でスクロールする）。
// 押しただけのタップは邪魔せず、動かしたあとのクリック（リンクを開くなど）だけ止める。マウス・ペンは標準のまま

const SLOP = 8; // これより小さい動きは手ぶれとしてタップのまま
const FRICTION = 0.995; // 慣性の減り方（1ミリ秒あたり。約1秒で止まる）

export function initTouchPan($col, enabled) {
  let pan = null; // { id, y, t, v, moved }
  let fingers = 0; // いまこの列に触れている指の数
  let glide = 0;
  let justMoved = false;

  // 指を離したあとも、そのときの速さで少し滑らせる
  const coast = (v) => {
    let prev = performance.now();
    const step = (now) => {
      const dt = Math.min(32, now - prev);
      prev = now;
      const before = $col.scrollTop;
      $col.scrollTop -= v * dt;
      v *= FRICTION ** dt;
      if (Math.abs(v) > 0.02 && $col.scrollTop !== before) glide = requestAnimationFrame(step);
    };
    glide = requestAnimationFrame(step);
  };

  $col.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType !== "touch" || !enabled()) return;
    cancelAnimationFrame(glide);
    fingers++;
    // 同じ列に2本目の指が来たら動かさない（拡大はページで止めている）
    pan = fingers > 1 ? null : { id: ev.pointerId, y: ev.clientY, startY: ev.clientY, startX: ev.clientX, t: ev.timeStamp, v: 0, moved: false };
  });
  $col.addEventListener("pointermove", (ev) => {
    if (!pan || ev.pointerId !== pan.id) return;
    if (!pan.moved) {
      if (Math.hypot(ev.clientX - pan.startX, ev.clientY - pan.startY) < SLOP) return;
      pan.moved = true;
      justMoved = true;
      try {
        $col.setPointerCapture(ev.pointerId);
      } catch {
        // 取れなくても動かせる
      }
    }
    const dy = ev.clientY - pan.y;
    const dt = ev.timeStamp - pan.t;
    if (dt > 0) pan.v = 0.8 * pan.v + 0.2 * (dy / dt);
    pan.y = ev.clientY;
    pan.t = ev.timeStamp;
    $col.scrollTop -= dy;
  });
  const end = (ev) => {
    if (ev.pointerType !== "touch") return;
    fingers = Math.max(0, fingers - 1);
    if (!pan || ev.pointerId !== pan.id) return;
    const p = pan;
    pan = null;
    // 止めてから離したときは滑らせない
    if (ev.type === "pointerup" && p.moved && ev.timeStamp - p.t < 80 && Math.abs(p.v) > 0.1) coast(p.v);
    if (p.moved) setTimeout(() => (justMoved = false), 0);
  };
  $col.addEventListener("pointerup", end);
  $col.addEventListener("pointercancel", end);
  // 動かしたあとに来るクリックは、リンクやボタンに届けない
  $col.addEventListener(
    "click",
    (ev) => {
      if (!justMoved) return;
      ev.stopPropagation();
      ev.preventDefault();
    },
    true
  );
}
