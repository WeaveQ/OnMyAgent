import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, "extract-changelog-section.mjs");
const enDoc = join(here, "../../website/docs/en/changelog.md");

test("extracts 0.5.25 bullets for GitHub notes", () => {
  const result = spawnSync(process.execPath, [script, "0.5.25", enDoc], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^## What's new\n/);
  assert.match(result.stdout, /First Settings model list/);
  assert.doesNotMatch(result.stdout, /latest-mac\.yml/);
  assert.doesNotMatch(result.stdout, /Download the attached/);
});
