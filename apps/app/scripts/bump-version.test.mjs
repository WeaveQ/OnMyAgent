import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { bump, VERSION_FILES } from "./bump-version.mjs";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

test("VERSION_FILES includes root and the four app packages", () => {
  assert.deepEqual(VERSION_FILES, [
    "package.json",
    "apps/app/package.json",
    "apps/desktop/package.json",
    "apps/orchestrator/package.json",
    "apps/server/package.json",
  ]);
});

test("bump computes the next semver", () => {
  assert.equal(bump("1.0.0", "patch"), "1.0.1");
  assert.equal(bump("0.5.22", "patch"), "0.5.23");
});

test("dry-run bump:set reports root package.json and does not write", () => {
  const output = execFileSync(
    process.execPath,
    [
      path.join("apps", "app", "scripts", "bump-version.mjs"),
      "--dry-run",
      "--set",
      "1.0.1",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const parsed = JSON.parse(output);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.version, "1.0.1");
  assert.equal(parsed.dryRun, true);
  assert.ok(parsed.files.includes("package.json"));
});
