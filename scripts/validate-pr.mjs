import { execFileSync } from "node:child_process";
import { lstat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_FILE_BYTES, readMessages } from "./messages.mjs";

const GITHUB_USERNAME = /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/;
const MESSAGE_PATH = /^messages\/(\d{4}-\d{2}-\d{2})-([A-Za-z0-9-]+)\.md$/;

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

export function validatePrChanges(changes, author) {
  if (!GITHUB_USERNAME.test(author ?? "")) throw new Error("无法识别 PR 作者的 GitHub 用户名。");
  if (changes.length !== 1) throw new Error("一次 PR 只能新增一个 messages/ 下的 Markdown 留言文件；不能修改或删除其他文件。");
  const [change] = changes;
  if (change.status !== "A") throw new Error("留言文件必须是新增文件；不允许修改、删除或重命名已有文件。");
  const match = change.path.match(MESSAGE_PATH);
  if (!match) throw new Error("文件必须位于 messages/，并命名为 YYYY-MM-DD-你的GitHub用户名.md。");
  const [, datePart, username] = match;
  const date = new Date(`${datePart}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== datePart) throw new Error("留言文件名中的日期无效。");
  if (username.toLowerCase() !== author.toLowerCase()) throw new Error(`文件名中的 GitHub 用户名「${username}」必须与 PR 作者「${author}」一致。`);
  return change.path;
}

function changedFiles(baseSha, headSha, cwd) {
  const mergeBase = git(["merge-base", baseSha, headSha], { cwd });
  const raw = execFileSync("git", ["diff", "--name-status", "-z", "--no-renames", mergeBase, headSha], { cwd, encoding: "utf8" });
  const parts = raw.split("\0").filter(Boolean);
  if (parts.length % 2 !== 0) throw new Error("无法解析 PR 相对于目标分支的完整文件变更。");
  const changes = [];
  for (let index = 0; index < parts.length; index += 2) changes.push({ status: parts[index], path: parts[index + 1] });
  return changes;
}

export async function preparePullRequestMessage({ baseSha, headSha, author, pullNumber, cwd = process.cwd() }) {
  if (!/^[a-f0-9]{40}$/i.test(baseSha ?? "") || !/^[a-f0-9]{40}$/i.test(headSha ?? "")) throw new Error("PR 提交信息无效，无法安全检查文件变更。");
  if (!/^\d+$/.test(String(pullNumber ?? ""))) throw new Error("PR 编号无效，无法获取留言内容。");

  const ref = `refs/remotes/codex/pr-${pullNumber}`;
  git(["fetch", "--no-tags", "origin", `+refs/pull/${pullNumber}/head:${ref}`], { cwd, encoding: "utf8" });
  const fetchedHead = git(["rev-parse", ref], { cwd });
  if (fetchedHead.toLowerCase() !== headSha.toLowerCase()) throw new Error("PR 分支在校验期间发生了更新，请重新推送后等待新一轮检查。");

  const changes = changedFiles(baseSha, fetchedHead, cwd);
  const relativePath = validatePrChanges(changes, author);
  const projectRoot = resolve(cwd);
  const destination = resolve(projectRoot, relativePath);
  if (!destination.startsWith(`${resolve(projectRoot, "messages")}/`) && !destination.startsWith(`${resolve(projectRoot, "messages")}\\`)) throw new Error("留言文件路径越出了 messages/ 目录。");
  try { await lstat(destination); throw new Error("该留言文件已存在；PR 只能新增文件。"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }

  const treeEntry = git(["ls-tree", fetchedHead, "--", relativePath], { cwd });
  if (!/^100(?:644|755) blob [a-f0-9]+\t/.test(treeEntry)) throw new Error("留言必须是普通 Markdown 文件，不能是符号链接或其他特殊文件。");
  const byteLength = Number(git(["cat-file", "-s", `${fetchedHead}:${relativePath}`], { cwd }));
  if (byteLength > MAX_FILE_BYTES) throw new Error(`留言文件超过 ${MAX_FILE_BYTES / 1024} KB 限制。`);
  const content = execFileSync("git", ["show", `${fetchedHead}:${relativePath}`], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  await writeFile(destination, content, { flag: "wx" });

  const messages = await readMessages(join(projectRoot, "messages"));
  const submitted = messages.find((message) => message.id === relativePath.slice("messages/".length, -3));
  if (!submitted) throw new Error("找不到刚提交的留言，请确认 Front Matter 和文件名符合规范。");
  if (submitted.github.toLowerCase() !== author.toLowerCase()) throw new Error(`Front Matter 中的 github「${submitted.github}」必须与 PR 作者「${author}」一致。`);
  console.log(`PR 变更范围检查通过：仅新增 ${relativePath}。`);
  console.log("留言格式、元数据、内容安全及重复用户名检查通过。");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await preparePullRequestMessage({
      baseSha: process.env.PR_BASE_SHA,
      headSha: process.env.PR_HEAD_SHA,
      author: process.env.PR_AUTHOR,
      pullNumber: process.env.PR_NUMBER,
      cwd: process.cwd(),
    });
  } catch (error) {
    console.error(`PR 校验失败：${error.message}`);
    process.exitCode = 1;
  }
}
