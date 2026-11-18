// 画面のどこでも使う小さな部品（main.js・cards.js・summary.js・plan.js・routemap-editor.js が読む）

// HTML に入れる文字のエスケープ。描画は文字列を組み立てて innerHTML に入れるので、データ由来の値は必ずこれを通す
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// "2027-02-06T10:30:00+09:00" / "2027-02-06T10:14:03+0900" → "10:30"
export const hhmm = (iso) => (iso && /T(\d\d:\d\d)/.exec(iso)?.[1]) || "";

// "2026-02-07" / "2026-02-28T09:00:00+09:00" → "2/7" / "2/28"
export const md = (iso) => (iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}` : "");

export const LABEL = {
  normal: "平常",
  delay: "遅れあり",
  suspended: "運休・見合わせ",
  unknown: "不明",
  offhours: "サービス時間外",
};
// 状態の印（路線図の線の上・カードのタイル・凡例）。文字では線が細いので、太い線の SVG で描く（色は delay.css の .dl-mark--*。
// ○ 緑・△ 濃い黄色・× 赤・− 灰。取得できずは「？」の文字）。読み上げでは横の状態の言葉を読むので、印は飾りとして扱う
const MARK_SHAPE = {
  normal: '<circle cx="12" cy="12" r="7.5"/>',
  delay: '<path d="M12 4.5 20 18.5H4z"/>',
  suspended: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  offhours: '<path d="M6 12h12"/>',
};
export const mark = (status) =>
  MARK_SHAPE[status]
    ? `<svg class="dl-mark dl-mark--${status}" viewBox="0 0 24 24" aria-hidden="true">${MARK_SHAPE[status]}</svg>`
    : `<span class="dl-mark dl-mark--unknown" aria-hidden="true">？</span>`;
// 状態のバッジ（delay.css の .dl-badge--{status}）。label がなければ状態ごとの決まった表記
export const badge = (status, label) =>
  `<span class="dl-badge dl-badge--${esc(status)}">${esc(label || LABEL[status] || LABEL.unknown)}</span>`;

// 押した先へのスクロール。「動きを減らす」設定のときは、なめらかに動かさずすぐ移る
export const scrollBehavior = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
