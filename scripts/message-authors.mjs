import { readFile } from "node:fs/promises";

export const GITHUB_LOGIN = /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/;
const MESSAGE_PATH = /^messages\/[\p{L}\p{N}][\p{L}\p{N} _().-]{0,119}\.md$/u;

export function validateMessageAuthorMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("作者记录必须是 JSON 对象。");
  const validated = {};
  for (const [path, record] of Object.entries(value)) {
    if (!MESSAGE_PATH.test(path) || path.includes("..")) throw new Error(`作者记录中包含无效留言路径：${path}`);
    if (!record || typeof record !== "object" || Array.isArray(record)
      || typeof record.login !== "string" || !GITHUB_LOGIN.test(record.login)
      || !Number.isInteger(record.pullRequest) || record.pullRequest < 1
      || typeof record.mergedAt !== "string" || Number.isNaN(Date.parse(record.mergedAt))) {
      throw new Error(`作者记录「${path}」格式无效。`);
    }
    validated[path] = {
      login: record.login,
      pullRequest: record.pullRequest,
      mergedAt: new Date(record.mergedAt).toISOString(),
    };
  }
  return validated;
}

export async function loadMessageAuthors(filePath) {
  try {
    const content = await readFile(filePath, "utf8");
    return validateMessageAuthorMap(JSON.parse(content.replace(/^\uFEFF/, "")));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    if (error instanceof SyntaxError) throw new Error(`作者记录文件不是有效 JSON：${error.message}`);
    throw error;
  }
}

export function recordMergedAuthors(currentRecords, pullRequest) {
  if (pullRequest?.merged !== true) throw new Error("只有已经合并的 PR 才能登记留言作者。");
  if (typeof pullRequest.login !== "string" || !GITHUB_LOGIN.test(pullRequest.login)) throw new Error("PR 作者的 GitHub 用户名无效。");
  if (!Number.isInteger(pullRequest.number) || pullRequest.number < 1) throw new Error("PR 编号无效。");
  if (typeof pullRequest.mergedAt !== "string" || Number.isNaN(Date.parse(pullRequest.mergedAt))) throw new Error("PR 合并时间无效。");
  if (!Array.isArray(pullRequest.files)) throw new Error("无法读取 PR 文件列表。");
  if (pullRequest.files.length !== 1 || pullRequest.files[0]?.status !== "added"
    || typeof pullRequest.files[0]?.filename !== "string"
    || !pullRequest.files[0].filename.startsWith("messages/")
    || !pullRequest.files[0].filename.endsWith(".md")) {
    throw new Error("只登记仅新增一个 messages/ Markdown 文件的 PR。");
  }

  const records = validateMessageAuthorMap(currentRecords);
  const mergedAt = new Date(pullRequest.mergedAt).toISOString();
  for (const file of pullRequest.files) {
    if (file?.status !== "added" || typeof file.filename !== "string" || !file.filename.startsWith("messages/")) continue;
    if (file.filename === "messages/_template.md" || !file.filename.endsWith(".md")) continue;
    if (!MESSAGE_PATH.test(file.filename) || file.filename.includes("..")) throw new Error(`PR 中有无效的留言文件路径：${file.filename}`);
    const existing = records[file.filename];
    if (existing) {
      if (existing.login !== pullRequest.login) throw new Error(`留言「${file.filename}」已有其他作者记录，拒绝覆盖。`);
      continue;
    }
    records[file.filename] = {
      login: pullRequest.login,
      pullRequest: pullRequest.number,
      mergedAt,
    };
  }
  return records;
}
