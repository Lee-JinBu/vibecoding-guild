import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";

for (const workflow of ["pr-validation.yml", "pages.yml", "record-message-authors.yml"]) {
  test(`${workflow} 是有效 YAML`, async () => {
    const source = await readFile(new URL(`../.github/workflows/${workflow}`, import.meta.url), "utf8");
    const document = parseDocument(source, { uniqueKeys: true });
    assert.equal(document.errors.length, 0, document.errors.map((error) => error.message).join("\n"));
  });
}

test("PR 工作流从目标分支加载，只读校验 PR 数据且不执行 Fork 代码", async () => {
  const source = await readFile(new URL("../.github/workflows/pr-validation.yml", import.meta.url), "utf8");
  const workflow = parseDocument(source).toJS();
  assert.ok(workflow.on.pull_request_target.branches.includes("main"));
  assert.equal(workflow.permissions.contents, "read");
  assert.match(source, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.doesNotMatch(source, /github\.event\.pull_request\.head\.sha[^\n]*ref:/);
  const validator = await readFile(new URL("./validate-pr.mjs", import.meta.url), "utf8");
  assert.match(validator, /merge-base/);
  assert.match(validator, /name-status/);
});

test("部署工作流只在 main push 触发并使用 Pages Actions", async () => {
  const source = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  const workflow = parseDocument(source).toJS();
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.deepEqual(workflow.on.repository_dispatch.types, ["message-authors-updated"]);
  assert.equal(workflow.concurrency.queue, "max");
  assert.equal(workflow.permissions.pages, undefined);
  assert.match(source, /actions\/upload-pages-artifact@v3/);
  assert.match(source, /actions\/deploy-pages@v4/);
  assert.match(source, /group: github-pages/);
});

test("作者登记只在 PR 合并后使用 GitHub 元数据并写入受保护映射", async () => {
  const source = await readFile(new URL("../.github/workflows/record-message-authors.yml", import.meta.url), "utf8");
  const workflow = parseDocument(source).toJS();
  assert.deepEqual(workflow.on.pull_request_target.branches, ["main"]);
  assert.deepEqual(workflow.on.pull_request_target.types, ["closed"]);
  assert.equal(workflow.concurrency.queue, "max");
  assert.match(workflow.jobs.record.if, /merged == true/);
  assert.equal(workflow.jobs.record.permissions.contents, "write");
  assert.equal(workflow.jobs.record.permissions["pull-requests"], "read");
  assert.equal(workflow.permissions.contents, "read");
  assert.match(source, /actions\/checkout@v4/);
  assert.match(source, /actions\/github-script@v7/);
  assert.match(source, /pr\.user\.login/);
  assert.match(source, /pulls\.listFiles/);
  assert.doesNotMatch(source, /pull_request\.head\.sha/);
});
