// 保存したお知らせの HTML で、LLM の要約・補足（src/notes.js）を手元で試す。事業者サイトへは取りに行かない
//   node scripts/llm-local.mjs snf 2026-01-09 お知らせ.html  silverferry お知らせ.html  sunflower トップ.html …
// 新日本海フェリーは日付（お知らせの日付。年を決めるのに使う）も付ける。シルバーフェリーはお知らせのページ、さんふらわあはトップのページ
// Claude API を呼ぶので、1件ごとに料金がかかる（Haiku 5.5 で1件0.1〜0.2円ほど）。API キーは worker/.env の ANT_API_TOKEN（Git には入れない）
// SNF_EFFORT=medium などで effort を、SNF_MODEL=claude-sonnet-5-5 などでモデルを替えて比べられる
import { readFileSync, existsSync } from "node:fs";
import { parseNotice as parseSnf } from "../src/sources/snf.js";
import { parseNotice as parseSilver } from "../src/sources/silverferry.js";
import { parseTop as parseSunflower } from "../src/sources/sunflower.js";
import { noticeTexts } from "../src/noticeTexts.js";
import { addNotes, LLM } from "../src/notes.js";

const ENV = new URL("../.env", import.meta.url);
if (existsSync(ENV)) process.loadEnvFile(ENV);
if (!process.env.ANT_API_TOKEN) {
  console.error("worker/.env に ANT_API_TOKEN を書いてください");
  process.exit(1);
}
if (process.env.SNF_EFFORT) LLM.effort = process.env.SNF_EFFORT;
if (process.env.SNF_MODEL) LLM.model = process.env.SNF_MODEL;

// 引数を1件ずつに分ける
const args = process.argv.slice(2);
const jobs = [];
for (let i = 0; i < args.length; ) {
  const id = args[i++];
  if (id === "snf") jobs.push({ id, date: args[i++], file: args[i++] });
  else if (id === "silverferry" || id === "sunflower") jobs.push({ id, file: args[i++] });
  else throw new Error(`知らない事業者: ${id}`);
}

// 1件ずつ services を作って読ませる（noticeTexts はキーが事業者ごとなので、同じ事業者は順に読む）
async function run({ id, date, file }) {
  const html = readFileSync(file, "utf8");
  noticeTexts.clear();
  let services;
  if (id === "snf") {
    const url = `https://www.snf.jp/local/`;
    const { text, ...parsed } = parseSnf(html, date);
    noticeTexts.set(`snf ${url}`, text);
    services = { snf: { ok: true, notices: [{ date, url, ...parsed }] } };
  } else if (id === "silverferry") {
    const { text, ...parsed } = parseSilver(html);
    noticeTexts.set("silverferry", text);
    services = { silverferry: { ok: true, ...parsed } };
  } else {
    services = { sunflower: { ok: true, ...parseSunflower(html) } };
  }
  const t0 = Date.now();
  let usage = null;
  await addNotes({ ANT_API_TOKEN: process.env.ANT_API_TOKEN }, services, null, (_, u) => (usage = u));
  const holder = id === "snf" ? services.snf.notices[0] : services[id];
  console.log(
    `===== ${id} ${file}（${Date.now() - t0}ms・${LLM.model}・effort ${LLM.effort}・入力 ${usage?.input_tokens ?? "?"}・出力 ${usage?.output_tokens ?? "?"}トークン）\n` +
      JSON.stringify({ llm: { ...holder.llm, sailings: undefined }, sailings: holder.sailings, unread: holder.unread }, null, 1)
  );
}
for (const job of jobs) await run(job);
