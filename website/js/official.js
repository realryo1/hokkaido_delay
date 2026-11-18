// 各社の公式ページとリンクの決まり（cards.js・main.js が読む）

// 各社の公式ページ。名前と URL は worker/src/collect.js の SOURCES と合わせる
// リンクはここに直書きしたものを使い、JSON の url（取得先の記録として Worker が残している）は使わない。
// 事業者のページから毎回取ってくるお知らせなどのリンクだけ、決まった形（https・ホスト・パス）のときに使う（javascript: などを入れないため）
export const OFFICIAL = {
  jr: { name: "JR北海道", url: "https://www3.jrhokkaido.co.jp/webunkou/" },
  subway: { name: "札幌市営地下鉄", url: "https://operationstatus.city.sapporo.jp/unkojoho/" },
  airport: { name: "新千歳空港（国内線）", url: "https://www.hokkaido-airports.com/ja/new-chitose/airport/fis/" },
  okadama: { name: "札幌丘珠空港", url: "https://okadama-airport.co.jp/flight/" },
  expressway: { name: "高速道路（アイハイウェイ）", url: "https://ihighway.jp/" },
  chuobus: { name: "北海道中央バス", url: "https://www.chuo-bus.co.jp/support/stop/" },
  hokto: { name: "北都交通", url: "https://www.hokto.co.jp/" },
  silverferry: { name: "シルバーフェリー（八戸〜苫小牧）", url: "https://www.silverferry.jp/" },
  sunflower: { name: "さんふらわあ（大洗〜苫小牧）", url: "https://www.sunflower.co.jp/" },
  snf: { name: "新日本海フェリー（舞鶴・敦賀・新潟・秋田〜小樽・苫小牧東）", url: "https://www.snf.jp/" },
  taiheiyo: { name: "太平洋フェリー（名古屋・仙台〜苫小牧）", url: "https://www.taiheiyo-ferry.co.jp/" },
};
export const officialUrl = (id) => OFFICIAL[id]?.url || "";

// JR北海道の線区ごとのページ（worker/src/sources/jr.js の LINES の senku と合わせる）
const JR_SENKU = { airport: "02", hakochise: "03", gakuen: "04", express: "01", shinkansen: "24" };
export const jrUrl = (id) => (JR_SENKU[id] ? `${OFFICIAL.jr.url}senku.html?id=${JR_SENKU[id]}` : OFFICIAL.jr.url);

// 毎回取ってくるリンク：形が合えばそのまま、合わなければ決まったページ
const LINK = {
  chuobus: /^https:\/\/www\.chuo-bus\.co\.jp\/support\/stop\/\?ope=list&rsn=\d+&ket=\d+$/,
  hokto: /^https:\/\/www\.hokto\.co\.jp\/[a-z0-9-]+\/$/,
  silverferry: /^https:\/\/www\.silverferry\.jp\/[\w./-]+$/,
  snf: /^https:\/\/www\.snf\.jp\/[\w./-]+$/,
};
export const SNF_LIST = "https://www.snf.jp/info-list/?info_group=operation";
export const linkOr = (id, url, fallback) => (typeof url === "string" && LINK[id].test(url) ? url : fallback);
