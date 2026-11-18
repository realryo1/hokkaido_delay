// 運行情報（試験版）の入口。index.html が type="module" で読む（公開時は deploy-pages.yml が esbuild で1本にまとめる）
// Cloudflare Worker（worker/）が5分ごとに集めた JSON を1本だけ取得して描画する。事業者サイトへは直接アクセスしない。
import { esc, hhmm } from "./util.js";
import { renderCards, officialLinks, ui } from "./cards.js";
import { renderSummary, SUMMARY } from "./summary.js";
import { ROUTEMAP } from "./routemap.js";
import { initLayout } from "./layout.js";
import { initPlan } from "./plan.js";

// Cloudflare Worker（worker/）の配信先。空にすると sample.json を表示する
const ENDPOINT = "https://delay.realryo1.com/status.json";
const REFRESH_MS = 60 * 1000;
const STALE_MIN = 20; // これより古ければ「更新が止まっている」と表示

// タッチでページ全体を拡大させない（iPhoneで拡大のあと「繰り返しエラー」になることがある）。iOS は viewport の user-scalable=no を無視するため
document.addEventListener("gesturestart", (ev) => ev.preventDefault());
document.addEventListener("gesturechange", (ev) => ev.preventDefault());

const params = new URLSearchParams(location.search);
const local = ["localhost", "127.0.0.1"].includes(location.hostname);
// ?sample でサンプル表示、手元確認のときだけ ?api=http://localhost:8787/status.json で取得先を差し替えられる
const source = params.has("sample") || !ENDPOINT ? "sample.json" : (local && params.get("api")) || ENDPOINT;

const $updated = document.getElementById("updated");
const $banners = document.getElementById("banners");
const $summary = document.getElementById("summary");
const $sections = document.getElementById("sections");
const $reload = document.getElementById("reload");

// お知らせ（#banners は role="status"）。1分ごとに同じ内容を書き直すと読み上げが繰り返されるので、変わったときだけ書き換える
let bannersHtml = "";
const setBanners = (html) => {
  if (html === bannersHtml) return;
  bannersHtml = html;
  $banners.innerHTML = html;
};

// 「飛行機が止まったら？」（plan.js）。取得するたびに運行情報を渡す
const updatePlan = initPlan();

let lastServices = {}; // 配線エディタで描き直すときに使う
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
  setBanners(banners.join(""));
  // 次回の予定時刻は Worker が入れる（next_update_at）。配信のキャッシュ（60秒）と画面の再取得（60秒）の分だけ少し遅れて反映される
  let next = "";
  if (!data.sample && data.next_update_at) {
    next = Date.parse(data.next_update_at) > Date.now() ? ` ／ 次は ${hhmm(data.next_update_at)}ごろ` : " ／ まもなく更新";
  }
  $updated.textContent = `${hhmm(data.updated_at)} 更新${next}`;
  // まとめと各社のカードは、別々の入れ物に描く（あいだに置くものが増えても描き分けられるように）
  lastServices = data.services || {};
  $summary.innerHTML = renderSummary(lastServices);
  // plan.js にシルバーフェリーの今の状況を渡す
  updatePlan(data);
  $sections.innerHTML = renderCards(lastServices);
}

// Worker は日本国内のネットワークにだけ返し、国外と判定すると 403（error: "region"）を返す（自国の SIM でローミング中・VPN など）
// そのときは位置情報の許可をもらい、約10km単位に丸めた現在地を付けて取り直す
let coords = null;
const endpoint = () => (coords ? `${source}${source.includes("?") ? "&" : "?"}lat=${coords.lat}&lon=${coords.lon}` : source);
const locateFailed = () => {
  setBanners(`<p class="dl-banner">位置情報を使えなかったため、運行情報を表示できません。各社の公式情報を確認してください。</p>`);
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
    setBanners(`<p class="dl-banner">現在地が日本国外と判定されたため、運行情報を表示できません。各社の公式情報を確認してください。</p>`);
  } else {
    setBanners(`<p class="dl-banner">日本国外のネットワーク（海外の SIM のローミング・VPN など）からの接続と判定されたため、運行情報を表示できません。日本国内にいる場合は、おおよその現在地（約10km単位）で確かめられます。
        <button type="button" class="dl-head__reload dl-banner__btn" data-locate>現在地で確かめる</button></p>`);
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
    setBanners(`<p class="dl-banner">運行情報を取得できませんでした${last ? "（前回の内容を表示中）" : ""}。各社の公式情報を確認してください。</p>`);
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
    if (ev.target.matches?.(".dl-flights")) ui.flightsOpen[ev.target.dataset.card] = ev.target.open;
    if (ev.target.matches?.(".dl-sailings")) ui.sailingsOpen = ev.target.open;
  },
  true
);
$sections.addEventListener("change", (ev) => {
  if (!ev.target.matches("[data-show-done]")) return;
  ui.showDone[ev.target.dataset.showDone] = ev.target.checked;
  if (last) render(last);
});
initLayout();
// 画面を見ているあいだだけ1分ごとに更新し、戻ってきたときにもすぐ更新する
setInterval(() => document.visibilityState === "visible" && load(), REFRESH_MS);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && load());
load();

// 配線エディタ（routemap-editor.js）：手元で ?edit を付けて開いたときだけ読み込む。
// 公開用に esbuild で1本にまとめるとき、エディタまで取り込まないよう、読み込み先は変数で渡す
if (local && params.has("edit")) {
  const editor = new URL("routemap-editor.js", import.meta.url).href;
  import(editor).then(({ startEditor }) =>
    startEditor({ map: ROUTEMAP, summary: SUMMARY, rerender: () => ($summary.innerHTML = renderSummary(lastServices)) })
  );
}
