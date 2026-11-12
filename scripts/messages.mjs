import { readdir, lstat, readFile, mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { marked } from "marked";
import { GITHUB_LOGIN, loadMessageAuthors, validateMessageAuthorMap } from "./message-authors.mjs";

export const MAX_FILE_BYTES = 10 * 1024;
const SAFE_FILENAME = /^[\p{L}\p{N}][\p{L}\p{N} _().-]{0,119}\.md$/u;
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
      case "html": fail(file, "包含原始 HTML，请使用普通 Markdown。"); break;
      case "image": fail(file, "留言中不能嵌入图片。"); break;
      default: fail(file, `包含暂不支持的 Markdown 格式「${token.type}」。`);
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
      case "html": fail(file, "包含原始 HTML，请使用普通 Markdown。"); break;
      default: fail(file, `包含暂不支持的 Markdown 格式「${token.type}」。`);
    }
  }).filter(Boolean);
}

function inlineText(nodes) {
  return nodes.map((node) => {
    if (node.type === "text" || node.type === "code") return node.value;
    if (node.type === "break") return " ";
    return node.children ? inlineText(node.children) : "";
  }).join("").replace(/\s+/g, " ").trim();
}

function parseMessage(source, file, authorMap) {
  source = source.replace(/^\uFEFF/, "");
  if (!SAFE_FILENAME.test(file) || basename(file) !== file || file.includes("..")) fail(file, "文件名无效，请使用简单文字并以 .md 结尾，例如：我的留言.md。");

  const match = source.match(FRONT_MATTER);
  let metadata = {};
  let markdown = source.trim();
  if (match) {
    const document = parseDocument(match[1], { uniqueKeys: true, schema: "core" });
    if (document.errors.length) fail(file, `YAML 格式错误：${document.errors[0].message}`);
    try { metadata = document.toJS({ maxAliasCount: 0 }); }
    catch (error) { fail(file, `YAML 元数据格式错误：${error.message}`); }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) fail(file, "YAML 元数据必须是对象。");
    if (Object.keys(metadata).some((key) => !["author", "github"].includes(key))) fail(file, "旧版留言只支持 author 和 github 字段。");
    if (metadata.author !== undefined && typeof metadata.author !== "string") fail(file, "旧版 author 字段必须是文字。");
    if (metadata.github !== undefined && typeof metadata.github !== "string") fail(file, "旧版 github 字段必须是文字。");
    markdown = match[2].trim();
  }

  if (!markdown) fail(file, "留言内容不能为空。");
  const body = markdownNodes(markdown, file);
  const titleIndex = body.findIndex((block) => block.type === "heading" && block.level === 1);
  const title = titleIndex >= 0 ? inlineText(body[titleIndex].children) : "冒险者留言";
  if (titleIndex >= 0) body.splice(titleIndex, 1);
  // Markdown Front Matter is user supplied, so it is never an identity source.
  const login = authorMap[`messages/${file}`]?.login;
  const github = login && GITHUB_LOGIN.test(login) ? login : "";
  return {
    author: github || "匿名冒险者",
    github,
    url: github ? `https://github.com/${github}` : "",
    title: title || "冒险者留言",
    body,
  };
}

export async function readMessages(directory, authorMap = {}) {
  const trustedAuthors = validateMessageAuthorMap(authorMap);
  const root = resolve(directory);
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw new Error(`无法读取留言目录：${error.message}`); }

  const files = entries.filter((entry) => {
    if (entry.name === "_template.md") return false;
    if (!entry.name.endsWith(".md")) fail(entry.name, "留言目录中只允许 Markdown（.md）文件。");
    return true;
  }).map((entry) => entry.name).sort();

  const messages = [];
  for (const file of files) {
    if (basename(file) !== file || file.includes("/") || file.includes("\\")) fail(file, "路径无效，留言必须直接放在 messages/ 目录中。");
    const fullPath = resolve(root, file);
    if (!fullPath.startsWith(`${root}${process.platform === "win32" ? "\\" : "/"}`)) fail(file, "留言文件路径超出了 messages/ 目录。");
    const info = await lstat(fullPath);
    if (!info.isFile()) fail(file, "留言必须是普通文件，不能是符号链接或目录。");
    if (info.size > MAX_FILE_BYTES) fail(file, `留言不能超过 ${MAX_FILE_BYTES / 1024} KB。`);
    const message = parseMessage(await readFile(fullPath, "utf8"), file, trustedAuthors);
    messages.push({ id: file.slice(0, -3), ...message });
  }
  return messages;
}

export async function generateMessages(directory, outputFile, authorMap = {}) {
  const messages = await readMessages(directory, authorMap);
  await mkdir(resolve(outputFile, ".."), { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(messages, null, 2)}\n`, "utf8");
  return messages;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  try {
    const authors = await loadMessageAuthors(join(projectRoot, "data", "message-authors.json"));
    const messages = await generateMessages(join(projectRoot, "messages"), join(projectRoot, "public", "messages.json"), authors);
    console.log(`留言检查通过，已生成 public/messages.json（${messages.length} 条）。`);
  } catch (error) {
    console.error(`留言检查失败：${error.message}`);
    process.exitCode = 1;
  }
}
