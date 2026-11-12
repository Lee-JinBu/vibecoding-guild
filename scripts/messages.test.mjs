import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readMessages, MAX_FILE_BYTES } from "./messages.mjs";

let root;
async function setup() { root = await mkdtemp(join(tmpdir(), "guild-messages-")); return root; }
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });
async function put(file, contents, directory = root) { await writeFile(join(directory, file), contents, "utf8"); }

 test("plain Markdown works without metadata and extracts its title", async () => {
  await setup(); await put("welcome.md", "# A new adventure\n\nMy first contribution to the guild.\n");
  const [item] = await readMessages(root);
  assert.equal(item.title, "A new adventure");
  assert.equal(item.author, "匿名冒险者");
  assert.equal(item.github, ""); assert.equal(item.url, "");
  assert.equal(item.body[0].children[0].value, "My first contribution to the guild.");
});

test("legacy YAML Front Matter remains supported but is not trusted for identity", async () => {
  await setup(); await put("legacy-note.md", "---\nauthor: Lin\ngithub: lin-codes\n---\n\n# Hello Guild\n\nNice to meet you.\n");
  const [item] = await readMessages(root);
  assert.equal(item.author, "匿名冒险者"); assert.equal(item.github, "");
  assert.equal(item.title, "Hello Guild"); assert.equal(item.body.length, 1);
});

test("invalid YAML Front Matter is rejected", async () => {
  await setup(); await put("broken.md", "---\nauthor: [broken\n---\ntext");
  await assert.rejects(readMessages(root), /YAML 格式错误/);
});

test("Front Matter identity claims cannot override trusted attribution", async () => {
  await setup(); await put("claim.md", "---\nauthor: Victim\ngithub: victim-account\n---\n\n# Hello\n");
  const [anonymous] = await readMessages(root);
  assert.equal(anonymous.author, "匿名冒险者");
  const [attributed] = await readMessages(root, {
    "messages/claim.md": { login: "actual-contributor", pullRequest: 12, mergedAt: "2026-11-13T00:00:00Z" },
  });
  assert.equal(attributed.author, "actual-contributor");
  assert.equal(attributed.github, "actual-contributor");
  assert.equal(attributed.url, "https://github.com/actual-contributor");
});

test("oversized messages are rejected", async () => {
  await setup(); await put("long-note.md", "x".repeat(MAX_FILE_BYTES + 1));
  await assert.rejects(readMessages(root), /不能超过 10 KB/);
});

test("raw HTML and dangerous links are rejected", async () => {
  await setup(); await put("unsafe.md", "<img src=x onerror=alert(1)>");
  await assert.rejects(readMessages(root), /原始 HTML/);
  await put("unsafe.md", "[click](javascript:alert%281%29)");
  await assert.rejects(readMessages(root), /不允许的链接协议|非法链接/);
});

test("empty directory returns an empty list", async () => {
  await setup(); assert.deepEqual(await readMessages(root), []);
});

test("underscore Markdown templates are ignored", async () => {
  await setup(); await put("_template.md", "template content"); assert.deepEqual(await readMessages(root), []);
});

test("other underscore files are rejected rather than silently ignored", async () => {
  await setup(); await put("_hidden.md", "hidden content");
  await assert.rejects(readMessages(root), /文件名无效/);
});

test("UTF-8 BOM and ordinary filenames are accepted", async () => {
  await setup(); await put("hello there.md", "\uFEFF# Welcome\n\nHello.\n");
  const [item] = await readMessages(root); assert.equal(item.title, "Welcome");
});

test("non-Markdown entries are rejected instead of silently ignored", async () => {
  await setup(); await put("notes.txt", "not a message");
  await assert.rejects(readMessages(root), /只允许 Markdown/);
});
