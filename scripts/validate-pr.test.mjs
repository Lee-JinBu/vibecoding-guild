import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_FILE_BYTES } from "./messages.mjs";
import { preparePullRequestMessage, validatePrChanges } from "./validate-pr.mjs";

function gitAt(directory, ...args) {
  return execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
async function makePr({ filename, content, earlierChange = false }) {
  const temporary = await mkdtemp(join(tmpdir(), "guild-pr-"));
  try {
    const remote = join(temporary, "remote.git"), source = join(temporary, "source"), checkout = join(temporary, "checkout");
    gitAt(temporary, "init", "--bare", remote); gitAt(temporary, "init", "-b", "main", source);
    gitAt(source, "config", "user.name", "Test User"); gitAt(source, "config", "user.email", "test@example.invalid");
    await mkdir(join(source, "messages")); await writeFile(join(source, "messages", "_template.md"), "template\n");
    await writeFile(join(source, "README.md"), "base\n"); gitAt(source, "add", "."); gitAt(source, "commit", "-m", "base");
    const baseSha = gitAt(source, "rev-parse", "HEAD");
    gitAt(source, "remote", "add", "origin", remote); gitAt(source, "push", "origin", "main"); gitAt(remote, "symbolic-ref", "HEAD", "refs/heads/main");
    gitAt(source, "checkout", "-b", "contribution");
    if (earlierChange) {
      await writeFile(join(source, "README.md"), "changed in an earlier commit\n");
      gitAt(source, "add", "README.md"); gitAt(source, "commit", "-m", "modify project file");
    }
    await writeFile(join(source, "messages", filename), content);
    gitAt(source, "add", `messages/${filename}`); gitAt(source, "commit", "-m", "add message");
    const headSha = gitAt(source, "rev-parse", "HEAD");
    gitAt(source, "push", "origin", "HEAD:refs/heads/contribution"); gitAt(remote, "update-ref", "refs/pull/7/head", headSha);
    gitAt(temporary, "clone", remote, checkout); gitAt(checkout, "checkout", "--detach", baseSha);
    return { temporary, checkout, baseSha, headSha, close: () => rm(temporary, { recursive: true, force: true }) };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }); throw error;
  }
}

test("a new Markdown file with an ordinary name is accepted", async () => {
  const pr = await makePr({ filename: "my first note.md", content: "# Hello\n\nA simple message without metadata.\n" });
  try {
    const message = await preparePullRequestMessage({ baseSha: pr.baseSha, headSha: pr.headSha, pullNumber: 7, cwd: pr.checkout });
    assert.equal(message.title, "Hello"); assert.equal(message.author, "匿名冒险者"); assert.equal(message.github, "");
    assert.equal(await readFile(join(pr.checkout, "messages", "my first note.md"), "utf8"), "# Hello\n\nA simple message without metadata.\n");
  } finally { await pr.close(); }
});

test("PRs cannot modify existing files or include non-message files", () => {
  assert.throws(() => validatePrChanges([{ status: "M", path: "messages/note.md" }]), /必须是新增文件/);
  assert.throws(() => validatePrChanges([{ status: "D", path: "messages/note.md" }]), /必须是新增文件/);
  for (const path of ["README.md", "src/main.ts", ".github/workflows/pages.yml", "package.json", "data/message-authors.json", "messages/note.txt"]) {
    assert.throws(() => validatePrChanges([{ status: "A", path }]), /必须放在 messages|以 \.md 结尾/);
  }
  for (const path of ["src/main.ts", ".github/workflows/pr-validation.yml", "package.json", "data/message-authors.json"]) {
    assert.throws(() => validatePrChanges([{ status: "M", path }]), /必须是新增文件/);
    assert.throws(() => validatePrChanges([{ status: "D", path }]), /必须是新增文件/);
  }
  assert.throws(() => validatePrChanges([{ status: "A", path: "messages/../README.md" }]), /路径符号/);
  assert.throws(() => validatePrChanges([{ status: "A", path: "messages/nested/note.md" }]), /路径符号/);
  assert.throws(() => validatePrChanges([{ status: "A", path: "messages/_template.md" }]), /下划线开头/);
  assert.throws(() => validatePrChanges([{ status: "A", path: "messages/hello.md" }, { status: "A", path: "messages/other.md" }]), /只能新增一个/);
});

test("a non-message change in an earlier PR commit is rejected", async () => {
  const pr = await makePr({ filename: "note.md", content: "# Hello\n\nMessage.\n", earlierChange: true });
  try {
    await assert.rejects(preparePullRequestMessage({ baseSha: pr.baseSha, headSha: pr.headSha, pullNumber: 7, cwd: pr.checkout }), /只能新增一个/);
  } finally { await pr.close(); }
});

test("oversized PR message files are rejected", async () => {
  const pr = await makePr({ filename: "long note.md", content: "x".repeat(MAX_FILE_BYTES + 1) });
  try {
    await assert.rejects(preparePullRequestMessage({ baseSha: pr.baseSha, headSha: pr.headSha, pullNumber: 7, cwd: pr.checkout }), /不能超过 10 KB/);
  } finally { await pr.close(); }
});
