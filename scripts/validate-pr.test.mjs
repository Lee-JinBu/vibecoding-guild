import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePrChanges } from "./validate-pr.mjs";

test("PR 可新增一个以作者用户名命名的留言", () => {
  assert.equal(validatePrChanges([{ status: "A", path: "messages/2026-11-12-student-dev.md" }], "student-dev"), "messages/2026-11-12-student-dev.md");
});

test("PR 禁止修改、删除、多个文件和非留言路径", () => {
  assert.throws(() => validatePrChanges([{ status: "M", path: "messages/2026-11-12-student-dev.md" }], "student-dev"), /新增文件/);
  assert.throws(() => validatePrChanges([{ status: "A", path: "messages/2026-11-12-student-dev.md" }, { status: "A", path: "README.md" }], "student-dev"), /只能新增一个/);
  assert.throws(() => validatePrChanges([{ status: "A", path: "src/main.ts" }], "student-dev"), /必须位于 messages/);
});

test("PR 文件名必须与作者用户名匹配", () => {
  assert.throws(() => validatePrChanges([{ status: "A", path: "messages/2026-11-12-other-user.md" }], "student-dev"), /必须与 PR 作者/);
});

test("PR 日期必须是有效日期", () => {
  assert.throws(() => validatePrChanges([{ status: "A", path: "messages/2026-02-30-student-dev.md" }], "student-dev"), /日期无效/);
});

import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { preparePullRequestMessage } from "./validate-pr.mjs";

function gitAt(directory, ...args) {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("PR 范围检查会拒绝较早提交中的非留言改动", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "guild-pr-history-"));
  try {
    const remote = join(temporary, "remote.git"), source = join(temporary, "source"), checkout = join(temporary, "checkout");
    gitAt(temporary, "init", "--bare", remote);
    gitAt(temporary, "init", "-b", "main", source);
    gitAt(source, "config", "user.name", "Test User"); gitAt(source, "config", "user.email", "test@example.invalid");
    await mkdir(join(source, "messages"));
    await writeFile(join(source, "messages", "_template.md"), "template\n");
    await writeFile(join(source, "README.md"), "base\n");
    gitAt(source, "add", "."); gitAt(source, "commit", "-m", "base");
    const baseSha = gitAt(source, "rev-parse", "HEAD");
    gitAt(source, "remote", "add", "origin", remote); gitAt(source, "push", "origin", "main");
    gitAt(remote, "symbolic-ref", "HEAD", "refs/heads/main");
    gitAt(source, "checkout", "-b", "contribution");
    await writeFile(join(source, "README.md"), "changed in an earlier commit\n");
    gitAt(source, "add", "README.md"); gitAt(source, "commit", "-m", "modify project file");
    await writeFile(join(source, "messages", "2026-11-12-student-dev.md"), "---\nauthor: Student\ngithub: student-dev\n---\n\nHello.\n");
    gitAt(source, "add", "messages/2026-11-12-student-dev.md"); gitAt(source, "commit", "-m", "add message");
    const headSha = gitAt(source, "rev-parse", "HEAD");
    gitAt(source, "push", "origin", "HEAD:refs/heads/contribution");
    gitAt(remote, "update-ref", "refs/pull/7/head", headSha);
    gitAt(temporary, "clone", remote, checkout); gitAt(checkout, "checkout", "--detach", baseSha);

    await assert.rejects(
      preparePullRequestMessage({ baseSha, headSha, author: "student-dev", pullNumber: 7, cwd: checkout }),
      /只能新增一个/,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("PR 校验器可从 Fork 变更读取并验证留言文件", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "guild-pr-valid-"));
  try {
    const remote = join(temporary, "remote.git"), source = join(temporary, "source"), checkout = join(temporary, "checkout");
    gitAt(temporary, "init", "--bare", remote); gitAt(temporary, "init", "-b", "main", source);
    gitAt(source, "config", "user.name", "Test User"); gitAt(source, "config", "user.email", "test@example.invalid");
    await mkdir(join(source, "messages")); await writeFile(join(source, "messages", "_template.md"), "template\n");
    await writeFile(join(source, "README.md"), "base\n"); gitAt(source, "add", "."); gitAt(source, "commit", "-m", "base");
    const baseSha = gitAt(source, "rev-parse", "HEAD");
    gitAt(source, "remote", "add", "origin", remote); gitAt(source, "push", "origin", "main"); gitAt(remote, "symbolic-ref", "HEAD", "refs/heads/main");
    gitAt(source, "checkout", "-b", "contribution");
    await writeFile(join(source, "messages", "2026-11-12-student-dev.md"), "---\nauthor: Student\ngithub: student-dev\n---\n\nHello.\n");
    gitAt(source, "add", "messages/2026-11-12-student-dev.md"); gitAt(source, "commit", "-m", "add message");
    const headSha = gitAt(source, "rev-parse", "HEAD"); gitAt(source, "push", "origin", "HEAD:refs/heads/contribution");
    gitAt(remote, "update-ref", "refs/pull/8/head", headSha);
    gitAt(temporary, "clone", remote, checkout); gitAt(checkout, "checkout", "--detach", baseSha);

    const messages = await preparePullRequestMessage({ baseSha, headSha, author: "student-dev", pullNumber: 8, cwd: checkout });
    assert.equal(messages, undefined);
    assert.equal(await readFile(join(checkout, "messages", "2026-11-12-student-dev.md"), "utf8"), "---\nauthor: Student\ngithub: student-dev\n---\n\nHello.\n");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
