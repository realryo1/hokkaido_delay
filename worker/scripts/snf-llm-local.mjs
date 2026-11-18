// 保存した新日本海フェリーのお知らせの HTML で、LLM の補足（src/snfNotes.js）を手元で試す。事業者サイトへは取りに行かない
//   node scripts/snf-llm-local.mjs 2026-01-09 お知らせ.html [2026-02-07 別の.html …]
// 日付はお知らせの日付（年を決めるのに使う）。Claude API を呼ぶので、1件ごとに料金がかかる（Haiku 5.5 で1件0.1円ほど）
// API キーは worker/.env の ANT_API_TOKEN（Git には入れない）
// SNF_EFFORT=medium などで effort を、SNF_MODEL=claude-sonnet-5-5 などでモデルを替えて比べられる
import { readFileSync, existsSync } from "node:fs";
import { parseNotice, noticeTexts } from "../src/sources/snf.js";
import { addSnfNotes, LLM } from "../src/snfNotes.js";

const ENV = new URL("../.env", import.meta.url);
if (existsSync(ENV)) process.loadEnvFile(ENV);
if (!process.env.ANT_API_TOKEN) {
  console.error("worker/.env に ANT_API_TOKEN を書いてください");
  process.exit(1);
}
if (process.env.SNF_EFFORT) LLM.effort = process.env.SNF_EFFORT;
if (process.env.SNF_MODEL) LLM.model = process.env.SNF_MODEL;

const args = process.argv.slice(2);
await Promise.all(
  Array.from({ length: args.length / 2 }, async (_, k) => {
    const [date, file] = [args[k * 2], args[k * 2 + 1]];
    const url = `https://www.snf.jp/local/${k}/`;
    const { text, ...parsed } = parseNotice(readFileSync(file, "utf8"), date);
    // noticeTexts は URL ごとなので、並べて呼んでも混ざらない
    noticeTexts.set(url, text);
    const svc = { ok: true, notices: [{ date, url, ...parsed }] };
    const t0 = Date.now();
    let usage = null;
    await addSnfNotes({ ANT_API_TOKEN: process.env.ANT_API_TOKEN }, svc, null, (u) => (usage = u));
    const n = svc.notices[0];
    console.log(
      `===== ${file}（${Date.now() - t0}ms・${LLM.model}・effort ${LLM.effort}・入力 ${usage?.input_tokens ?? "?"}・出力 ${usage?.output_tokens ?? "?"}トークン）\n` +
        JSON.stringify({ llm: { ...n.llm, sailings: undefined }, sailings: n.sailings, unread: n.unread }, null, 1)
    );
  })
);
