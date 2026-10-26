// Cloudflare を使わずに、手元の Node.js で収集処理だけを1回動かして JSON を表示する
//   node worker/scripts/collect-local.mjs            … 標準出力へ
//   node worker/scripts/collect-local.mjs out.json   … ファイルへ
// 事業者サイトへアクセスするので、連続実行はしないこと。
import { writeFileSync } from "node:fs";
import { collect } from "../src/collect.js";

const out = JSON.stringify(await collect(), null, 2);
const file = process.argv[2];
if (file) {
  writeFileSync(file, out + "\n");
  console.error(`wrote ${file}`);
} else {
  console.log(out);
}
