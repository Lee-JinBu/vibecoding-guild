import { readdir, lstat, readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { marked } from "marked";

export const MAX_FILE_BYTES = 10 * 1024;
const MAX_AUTHOR_LENGTH = 40;
const USERNAME = /^(?!-)(?!.*--)[A-Za-z0-9-]{1,39}(?<!-)$/;
const FILENAME = /^\d{4}-\d{2}-\d{2}-[\p{L}\p{N}_-]{1,40}\.md$/u;
const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

function fail(file, reason) {
  throw new Error(`留言文件「${file}」${reason}`);
}

function safeUrl(href, file) {
  if (typeof href !== "string" || /[\u0000-\u0020\\]/.test(href)) fail(file, "包含格式错误的链接。");
  let parsed;
  try { parsed = new URL(href); } catch { fail(file, `包含非法链接「${href}」，链接必须使用完整的 http 或 https 地址。`); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") fail(file, `包含不允许的链接协议「${parsed.protocol}」。`);
  return parsed.href;
}

function inlineNodes(tokens, file) {
  return tokens.map((token) => {
    switch (token.type) {
      case "text": return { type: "text", value: token.text };
      case "strong": case "em": case "del": return { type: token.type, children: inlineNodes(token.tokens, file) };
      case "codespan": return { type: "code", value: token.text };
      case "br": return { type: "break" };
      case "link": return { type: "link", href: safeUrl(token.href, file), children: inlineNodes(token.tokens, file) };
      case "escape": return { type: "text", value: token.text };
      case "html": fail(file, "包含原始 HTML；请使用 Markdown 格式。"); break;
      case "image": fail(file, "不允许在留言中嵌入图片。"); break;
      default: fail(file, `包含不支持的 Markdown 格式「${token.type}」。`);
    }
  });
}

function markdownNodes(body, file) {
  const tokens = marked.lexer(body, { gfm: true });
  return tokens.map((token) => {
    switch (token.type) {
      case "heading": return { type: "heading", level: token.depth, children: inlineNodes(token.tokens, file) };
      case "paragraph": return { type: "paragraph", children: inlineNodes(token.tokens, file) };
      case "text": return { type: "paragraph", children: inlineNodes(token.tokens, file) };
      case "blockquote": return { type: "blockquote", children: markdownNodes(token.text, file) };
      case "list": return { type: "list", ordered: token.ordered, items: token.items.map((item) => markdownNodes(item.text, file)) };
      case "code": return { type: "codeBlock", value: token.text, language: /^[a-z0-9_-]{1,20}$/i.test(token.lang ?? "") ? token.lang : "" };
      case "hr": return { type: "divider" };
      case "space": return null;
      case "html": fail(file, "包含原始 HTML；请使用 Markdown 格式。"); break;
      default: fail(file, `包含不支持的 Markdown 格式「${token.type}」。`);
    }
  }).filter(Boolean);
}

function parseMessage(source, file) {
  source = source.replace(/^\uFEFF/, "");
  if (!FILENAME.test(file) || basename(file) !== file) fail(file, "文件名不符合要求，应为 YYYY-MM-DD-昵称.md（昵称仅可使用中英文、数字、下划线和连字符）。");
  const datePart = file.slice(0, 10);
  const date = new Date(`${datePart}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== datePart) fail(file, "文件名中的日期无效。");
  const match = source.match(FRONT_MATTER);
  if (!match) fail(file, "缺少有效的 YAML Front Matter，请以 --- 开始并用 --- 结束元数据。");
  const document = parseDocument(match[1], { uniqueKeys: true, schema: "core" });
  if (document.errors.length) fail(file, `YAML 格式错误：${document.errors[0].message}`);
  let metadata;
  try { metadata = document.toJS({ maxAliasCount: 0 }); } catch (error) { fail(file, `YAML 元数据不安全或格式错误：${error.message}`); }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) fail(file, "YAML 元数据必须是对象。");
  if (Object.keys(metadata).some((key) => !["author", "github"].includes(key))) fail(file, "只允许 author 和 github 两个元数据字段。");
  if (typeof metadata.author !== "string" || !metadata.author.trim() || metadata.author.trim().length > MAX_AUTHOR_LENGTH) fail(file, `author 必填且长度不能超过 ${MAX_AUTHOR_LENGTH} 个字符。`);
  if (typeof metadata.github !== "string" || !USERNAME.test(metadata.github)) fail(file, "github 必填，且必须是有效的 GitHub 用户名（1–39 位字母、数字或单连字符）。");
  const body = match[2].trim();
  if (!body) fail(file, "留言正文不能为空。");
  return {
    author: metadata.author.trim(),
    github: metadata.github,
    url: `https://github.com/${metadata.github}`,
    body: markdownNodes(body, file),
  };
}

export async function readMessages(directory) {
  const root = resolve(directory);
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw new Error(`无法读取留言目录：${error.message}`); }
  const files = entries.filter((entry) => entry.name.endsWith(".md") && !entry.name.startsWith("_")).map((entry) => entry.name).sort();
  const usernames = new Set();
  const messages = [];
  for (const file of files) {
    if (basename(file) !== file || file.includes("..") || file.includes("/") || file.includes("\\")) fail(file, "文件名包含非法路径字符。");
    const fullPath = resolve(root, file);
    if (!fullPath.startsWith(`${root}${process.platform === "win32" ? "\\" : "/"}`)) fail(file, "文件路径越出留言目录。");
    const info = await lstat(fullPath);
    if (!info.isFile()) fail(file, "必须是普通文件，不能是符号链接或目录。");
    if (info.size > MAX_FILE_BYTES) fail(file, `内容超过 ${MAX_FILE_BYTES / 1024} KB 限制。`);
    const message = parseMessage(await readFile(fullPath, "utf8"), file);
    const normalizedUsername = message.github.toLowerCase();
    if (usernames.has(normalizedUsername)) fail(file, `GitHub 用户名「${message.github}」重复，每位用户只能提交一条留言。`);
    usernames.add(normalizedUsername);
    messages.push({ id: file.slice(0, -3), ...message });
  }
  return messages;
}

export async function generateMessages(directory, outputFile) {
  const messages = await readMessages(directory);
  await mkdir(resolve(outputFile, ".."), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(messages, null, 2)}\n`, "utf8");
  return messages;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  try {
    const messages = await generateMessages(join(projectRoot, "messages"), join(projectRoot, "public", "messages.json"));
    console.log(`留言校验通过，已生成 public/messages.json（${messages.length} 条）。`);
  } catch (error) {
    console.error(`留言校验失败：${error.message}`);
    process.exitCode = 1;
  }
}
