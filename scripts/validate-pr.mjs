import { execFileSync } from "node:child_process";
import { lstat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_FILE_BYTES, readMessages } from "./messages.mjs";

const SAFE_FILENAME = /^[\p{L}\p{N}][\p{L}\p{N} _().-]{0,119}\.md$/u;

function git(args, options = {}) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
}

export function validatePrChanges(changes) {
  if (changes.length !== 1) throw new Error("一次 PR 只能新增一个 messages/ 下的 Markdown 留言文件，不能修改或删除其他文件。");
  const [change] = changes;
  if (change.status !== "A") throw new Error("留言必须是新增文件；不允许修改、删除或重命名已有文件。");
  if (!change.path.startsWith("messages/") || change.path.includes("\\")) throw new Error("留言文件必须放在 messages/ 目录中。");
  const filename = change.path.slice("messages/".length);
  if (filename.includes("/") || filename.includes("..") || filename.startsWith("_")) throw new Error("请直接在 messages/ 目录新增留言文件，不要使用子目录、路径符号或下划线开头的文件名。");
  if (!SAFE_FILENAME.test(filename)) throw new Error("留言文件名请使用简单文字，并以 .md 结尾，例如：我的留言.md。");
  return change.path;
}

function changedFiles(baseSha, headSha, cwd) {
  const mergeBase = git(["merge-base", baseSha, headSha], { cwd });
  const raw = execFileSync("git", ["diff", "--name-status", "-z", "--no-renames", mergeBase, headSha], { cwd, encoding: "utf8" });
  const parts = raw.split("\0").filter(Boolean);
  if (parts.length % 2 !== 0) throw new Error("无法读取 PR 的文件变更，请重新提交后再试。");
  const changes = [];
  for (let index = 0; index < parts.length; index += 2) changes.push({ status: parts[index], path: parts[index + 1] });
  return changes;
}

export async function preparePullRequestMessage({ baseSha, headSha, pullNumber, cwd = process.cwd() }) {
  if (!/^[a-f0-9]{40}$/i.test(baseSha ?? "") || !/^[a-f0-9]{40}$/i.test(headSha ?? "")) throw new Error("PR 提交信息无效，无法检查文件变更。");
  if (!/^\d+$/.test(String(pullNumber ?? ""))) throw new Error("PR 编号无效，无法读取留言文件。");

  const ref = `refs/remotes/codex/pr-${pullNumber}`;
  git(["fetch", "--no-tags", "origin", `+refs/pull/${pullNumber}/head:${ref}`], { cwd, encoding: "utf8" });
  const fetchedHead = git(["rev-parse", ref], { cwd });
  if (fetchedHead.toLowerCase() !== headSha.toLowerCase()) throw new Error("PR 内容刚刚更新，请等待新一轮检查完成。");

  const relativePath = validatePrChanges(changedFiles(baseSha, fetchedHead, cwd));
  const projectRoot = resolve(cwd);
  const messagesDirectory = resolve(projectRoot, "messages");
  const destination = resolve(projectRoot, relativePath);
  if (!destination.startsWith(`${messagesDirectory}/`) && !destination.startsWith(`${messagesDirectory}\\`)) throw new Error("留言文件路径超出了 messages/ 目录。");
  try { await lstat(destination); throw new Error("这个留言文件已经存在，请换一个文件名。"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }

  const treeEntry = git(["ls-tree", fetchedHead, "--", relativePath], { cwd });
  if (!/^100(?:644|755) blob [a-f0-9]+\t/.test(treeEntry)) throw new Error("留言必须是普通 Markdown 文件。");
  const byteLength = Number(git(["cat-file", "-s", `${fetchedHead}:${relativePath}`], { cwd }));
  if (byteLength > MAX_FILE_BYTES) throw new Error(`留言不能超过 ${MAX_FILE_BYTES / 1024} KB。请删减部分内容后再提交。`);
  const content = execFileSync("git", ["show", `${fetchedHead}:${relativePath}`], { cwd, stdio: ["ignore", "pipe", "pipe"] });
  await writeFile(destination, content, { flag: "wx" });

  const messages = await readMessages(messagesDirectory);
  const submitted = messages.find((message) => message.id === relativePath.slice("messages/".length, -3));
  if (!submitted) throw new Error("没有读到这条留言，请检查 Markdown 内容后重试。");
  console.log(`留言已通过检查：${filenameForLog(relativePath)}。`);
  return submitted;
}

function filenameForLog(relativePath) {
  return relativePath.slice("messages/".length);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await preparePullRequestMessage({
      baseSha: process.env.PR_BASE_SHA,
      headSha: process.env.PR_HEAD_SHA,
      pullNumber: process.env.PR_NUMBER,
      cwd: process.cwd(),
    });
  } catch (error) {
    console.error(`PR 留言检查没通过：${error.message}`);
    process.exitCode = 1;
  }
}
