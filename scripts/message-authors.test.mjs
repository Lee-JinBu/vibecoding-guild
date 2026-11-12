import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readMessages } from "./messages.mjs";
import { recordMergedAuthors, loadMessageAuthors } from "./message-authors.mjs";

const merged = (overrides = {}) => ({
  merged: true,
  login: "new-adventurer",
  number: 41,
  mergedAt: "2026-11-13T02:00:00Z",
  files: [{ filename: "messages/hello.md", status: "added" }],
  ...overrides,
});

test("已合并 PR 使用 GitHub 提供的作者信息展示普通 Markdown 留言", async () => {
  const authors = recordMergedAuthors({}, merged());
  const root = await mkdtemp(join(tmpdir(), "guild-authors-"));
  try {
    await writeFile(join(root, "hello.md"), "# Hello\n\nWelcome!\n");
    const [message] = await readMessages(root, authors);
    assert.equal(message.author, "new-adventurer");
    assert.equal(message.github, "new-adventurer");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Front Matter 伪造身份不能覆盖合并 PR 的可信作者", async () => {
  const authors = recordMergedAuthors({}, merged());
  const root = await mkdtemp(join(tmpdir(), "guild-spoof-"));
  try {
    await writeFile(join(root, "hello.md"), "---\nauthor: victim\ngithub: victim\n---\n\n# Hello\n");
    const [message] = await readMessages(root, authors);
    assert.equal(message.author, "new-adventurer");
    assert.notEqual(message.github, "victim");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("历史留言没有登记记录时匿名显示，不从文件名推断身份", async () => {
  const root = await mkdtemp(join(tmpdir(), "guild-history-"));
  try {
    await writeFile(join(root, "old-octocat.md"), "---\nauthor: Octocat\ngithub: octocat\n---\n\n# Old\n");
    const [message] = await readMessages(root, await loadMessageAuthors(join(root, "missing.json")));
    assert.equal(message.author, "匿名冒险者");
    assert.equal(message.github, "");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("连续合并的多个 PR 累积作者记录且互不覆盖", () => {
  const first = recordMergedAuthors({}, merged({ files: [{ filename: "messages/first.md", status: "added" }] }));
  const second = recordMergedAuthors(first, merged({
    number: 42,
    login: "another-adventurer",
    files: [{ filename: "messages/second.md", status: "added" }],
  }));
  assert.deepEqual(Object.keys(second).sort(), ["messages/first.md", "messages/second.md"]);
  assert.equal(second["messages/first.md"].login, "new-adventurer");
  assert.equal(second["messages/second.md"].login, "another-adventurer");
});

test("未合并 PR、非法路径和覆盖既有其他作者都会被拒绝", () => {
  assert.throws(() => recordMergedAuthors({}, merged({ merged: false })), /只有已经合并/);
  assert.throws(() => recordMergedAuthors({}, merged({ files: [{ filename: "messages/../outside.md", status: "added" }] })), /无效的留言文件路径/);
  assert.throws(() => recordMergedAuthors({ "messages/hello.md": { login: "another-user", pullRequest: 1, mergedAt: "2026-01-01T00:00:00Z" } }, merged()), /拒绝覆盖/);
  assert.throws(() => recordMergedAuthors({}, merged({ files: [
    { filename: "messages/hello.md", status: "added" },
    { filename: "data/message-authors.json", status: "modified" },
  ] })), /只登记仅新增一个/);
  assert.throws(() => recordMergedAuthors({}, merged({ files: [{ filename: "data/message-authors.json", status: "deleted" }] })), /只登记仅新增一个/);
});
