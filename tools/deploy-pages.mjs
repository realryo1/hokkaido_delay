// F5 で実行する: main を push してから GitHub Pages のデプロイ（deploy-pages.yml）を起動し、完了まで待つ。
// コミットはしない。未コミットの変更がある場合は中断する（デプロイされるのは push 済みの main だけのため）。
// 認証は git push と同じ Git Credential Manager の認証情報を使う（gh CLI は不要）。
// 使い方: F5（.vscode/launch.json の「Deploy: push → GitHub Pages」）。
//         --dry-run を付けると push も起動もせず、確認だけ行う。

import { spawnSync } from "node:child_process";

const WORKFLOW_FILE = "deploy-pages.yml";
const BRANCH = "main";
const DRY_RUN = process.argv.includes("--dry-run");
const POLL_MS = 10_000;
const TIMEOUT_MS = 30 * 60_000;

const log = (msg) => console.log(msg);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function die(msg) {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
}

function git(args, { inherit = false } = {}) {
  return spawnSync("git", args, {
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
}

// origin の URL から owner / repo を取り出す
const remote = git(["remote", "get-url", "origin"]).stdout.trim();
const match = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
if (!match) die(`origin が GitHub のリポジトリではありません: ${remote}`);
const [, owner, repo] = match;

// 1. ブランチが main か
const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.trim();
if (branch !== BRANCH) die(`現在のブランチは ${branch} です。${BRANCH} に切り替えてから実行してください。`);

// 2. 未コミットの変更がないか（push しても反映されないため）
const dirty = git(["status", "--porcelain"]).stdout.trim();
if (dirty) {
  die(`未コミットの変更があります。コミットしてから再度 F5 を押してください。\n${dirty}`);
}

// 3. 認証トークンを取得（push と同じ認証情報。表示はしない）
const credential = spawnSync("git", ["credential", "fill"], {
  input: "protocol=https\nhost=github.com\n\n",
  encoding: "utf8",
});
const passwordLine = credential.stdout.split("\n").find((line) => line.startsWith("password="));
if (!passwordLine) die("GitHub の認証情報が見つかりません。先に git push を一度実行してサインインしてください。");
const token = passwordLine.slice("password=".length);

async function api(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.text();
    die(`GitHub API ${method} ${path} が失敗しました（${res.status}）: ${detail}\n` +
      "トークンの権限不足の可能性があります。Actions（workflow）への書き込み権限を確認してください。");
  }
  return res.status === 204 ? null : res.json();
}

const runsPath = `/actions/workflows/${WORKFLOW_FILE}/runs`;
const pagesUrl = `https://${owner}.github.io/${repo}/`;

// 公開中の index.html の版（ワークフローがデプロイのたびに JS / CSS の ?v= をデプロイ時刻にするので、中身が毎回変わる）。
// ワークフローが終わっても CDN（Fastly）が古いファイルを返すことがあるため、変わるまで待つのに使う
const CDN_POLL_MS = 5_000;
const CDN_TIMEOUT_MS = 10 * 60_000;
async function publishedData() {
  try {
    const res = await fetch(`${pagesUrl}index.html`, { cache: "no-store" });
    if (!res.ok) return null;
    const version = (await res.text()).match(/\?v=(\d+)/)?.[1] ?? "?";
    return { version, key: version };
  } catch {
    return null;
  }
}
const publishedBefore = await publishedData();

// 4. push（コミットはしない）
log(`▶ ${owner}/${repo} の ${BRANCH} を push します`);
if (DRY_RUN) {
  log("  [dry-run] git push はスキップ");
} else {
  const push = git(["push", "origin", BRANCH], { inherit: true });
  if (push.status !== 0) die("git push に失敗しました。上のログを確認してください。");
}

// 5. 起動前の最新実行 ID を控えておき、起動後に増えた実行を探す
const before = await api("GET", `${runsPath}?per_page=1`);
const previousId = before.workflow_runs[0]?.id ?? 0;

if (DRY_RUN) {
  const latest = before.workflow_runs[0];
  log(latest
    ? `  [dry-run] 直近の実行: ${latest.html_url}（${latest.status} / ${latest.conclusion ?? "-"}）`
    : "  [dry-run] 直近の実行はまだありません");
  log(`  [dry-run] 公開中の版: ${publishedBefore?.version ?? "取得できませんでした"}`);
  log("  [dry-run] ワークフローの起動はスキップ");
  log("✔ 確認完了（push と起動は行っていません）");
  process.exit(0);
}

// 6. ワークフローを起動（main）
log(`▶ ${WORKFLOW_FILE} を起動します`);
await api("POST", `/actions/workflows/${WORKFLOW_FILE}/dispatches`, { ref: BRANCH });

let run;
for (let waited = 0; waited < 60_000 && !run; waited += 3_000) {
  await sleep(3_000);
  const list = await api("GET", `${runsPath}?per_page=5`);
  run = list.workflow_runs.find((r) => r.id > previousId);
}
if (!run) die(`起動した実行が見つかりませんでした。Actions ページで確認してください: https://github.com/${owner}/${repo}/actions/workflows/${WORKFLOW_FILE}`);
log(`  実行: ${run.html_url}`);

// 7. 完了まで待つ（状態が変わったときだけ表示）
const deadline = Date.now() + TIMEOUT_MS;
let current = run;
let lastStatus = "";
while (current.status !== "completed") {
  if (current.status !== lastStatus) {
    log(`  状態: ${current.status}`);
    lastStatus = current.status;
  }
  if (Date.now() > deadline) die(`30分待っても完了しませんでした: ${run.html_url}`);
  await sleep(POLL_MS);
  current = await api("GET", `/actions/runs/${run.id}`);
}

if (current.conclusion !== "success") {
  die(`デプロイが ${current.conclusion} で終わりました: ${current.html_url}`);
}

// 8. CDN が新しいファイルを返すまで待つ（index.html の版が変わるまで）
log("▶ 公開URLに反映されるのを待ちます");
const cdnStart = Date.now();
let published = await publishedData();
while (!published || published.key === publishedBefore?.key) {
  if (Date.now() - cdnStart > CDN_TIMEOUT_MS) {
    die(`10分待っても公開URLの index.html が新しくなりませんでした（版: ${published?.version ?? "取得できず"}）: ${pagesUrl}index.html`);
  }
  await sleep(CDN_POLL_MS);
  published = await publishedData();
}
log(`  版: ${publishedBefore?.version ?? "-"} → ${published.version}（ワークフロー完了から ${Math.round((Date.now() - cdnStart) / 1000)} 秒）`);
log(`✔ デプロイ完了: ${pagesUrl}`);
