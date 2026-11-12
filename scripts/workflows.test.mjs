import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseDocument } from "yaml";

for (const workflow of ["pr-validation.yml", "pages.yml"]) {
  test(`${workflow} 是有效 YAML`, async () => {
    const source = await readFile(new URL(`../.github/workflows/${workflow}`, import.meta.url), "utf8");
    const document = parseDocument(source, { uniqueKeys: true });
    assert.equal(document.errors.length, 0, document.errors.map((error) => error.message).join("\n"));
  });
}

test("PR 工作流只读，使用 pull_request，且不运行 pull_request_target", async () => {
  const source = await readFile(new URL("../.github/workflows/pr-validation.yml", import.meta.url), "utf8");
  const workflow = parseDocument(source).toJS();
  assert.ok(workflow.on.pull_request.branches.includes("main"));
  assert.equal(workflow.permissions.contents, "read");
  assert.equal(source.includes("pull_request_target"), false);
  const validator = await readFile(new URL("./validate-pr.mjs", import.meta.url), "utf8");
  assert.match(validator, /merge-base/);
  assert.match(validator, /name-status/);
});

test("部署工作流只在 main push 触发并使用 Pages Actions", async () => {
  const source = await readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  const workflow = parseDocument(source).toJS();
  assert.deepEqual(workflow.on.push.branches, ["main"]);
  assert.equal(workflow.permissions.pages, undefined);
  assert.match(source, /actions\/upload-pages-artifact@v3/);
  assert.match(source, /actions\/deploy-pages@v4/);
  assert.match(source, /group: github-pages/);
});
