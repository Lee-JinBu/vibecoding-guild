import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readMessages, MAX_FILE_BYTES } from "./messages.mjs";

let root;
async function setup() { root = await mkdtemp(join(tmpdir(), "guild-messages-")); return root; }
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
async function put(file, contents, directory = root) { await writeFile(join(directory, file), contents, "utf8"); }
function message(github = "new-student", body = "初次来到公会！") {
  return `---\nauthor: 冒险者\ngithub: ${github}\n---\n\n${body}\n`;
}

test("合法留言读取为安全的结构化数据", async () => {
  await setup(); await put("2026-11-12-student.md", message("new-student", "欢迎 **大家**，[GitHub](https://github.com)"));
  const [item] = await readMessages(root);
  assert.equal(item.author, "冒险者"); assert.equal(item.github, "new-student");
  assert.deepEqual(item.body[0].children[1], { type: "strong", children: [{ type: "text", value: "大家" }] });
  assert.equal(item.body[0].children[3].href, "https://github.com/");
});

test("无效 YAML 被拒绝", async () => {
  await setup(); await put("2026-11-12-student.md", "---\nauthor: [broken\n---\ntext");
  await assert.rejects(readMessages(root), /YAML 格式错误/);
});

test("缺少必填字段被拒绝", async () => {
  await setup(); await put("2026-11-12-student.md", "---\nauthor: 冒险者\n---\n正文");
  await assert.rejects(readMessages(root), /github 必填/);
});

test("重复用户名（忽略大小写）被拒绝", async () => {
  await setup(); await put("2026-11-12-a.md", message("SameUser")); await put("2026-11-12-b.md", message("sameuser"));
  await assert.rejects(readMessages(root), /用户名.*重复/);
});

test("超长留言被拒绝", async () => {
  await setup(); await put("2026-11-12-student.md", message("new-student", "字".repeat(MAX_FILE_BYTES)));
  await assert.rejects(readMessages(root), /超过 10 KB 限制/);
});

test("原始 HTML、危险链接和非 HTTP(S) 链接被拒绝", async () => {
  await setup(); await put("2026-11-12-student.md", message("new-student", "<img src=x onerror=alert(1)>"));
  await assert.rejects(readMessages(root), /原始 HTML/);
  await put("2026-11-12-student.md", message("new-student", "[点我](javascript:alert%281%29)"));
  await assert.rejects(readMessages(root), /不允许的链接协议|非法链接/);
});

test("Windows UTF-8 BOM is accepted", async () => {
  await setup(); await put("2026-11-12-student.md", "\uFEFF" + message());
  const items = await readMessages(root); assert.equal(items.length, 1);
});

test("空留言目录返回空列表", async () => {
  await setup(); assert.deepEqual(await readMessages(root), []);
});

test("下划线开头模板会被忽略", async () => {
  await setup(); await put("_template.md", "malicious"); assert.deepEqual(await readMessages(root), []);
});

test("文件名穿越和不规范文件名被拒绝", async () => {
  await setup(); await put("bad.md", message()); await assert.rejects(readMessages(root), /文件名不符合要求/);
});


