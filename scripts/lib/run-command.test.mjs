import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resolveCommand } from "./run-command.mjs";

describe("resolveCommand", () => {
  test("leaves bare commands unchanged off Windows", () => {
    if (process.platform === "win32") return;
    assert.equal(resolveCommand("pnpm"), "pnpm");
    assert.equal(resolveCommand("npm"), "npm");
    assert.equal(resolveCommand("node"), "node");
  });

  test("maps package-manager shims to .cmd on Windows", () => {
    if (process.platform !== "win32") return;
    assert.equal(resolveCommand("pnpm"), "pnpm.cmd");
    assert.equal(resolveCommand("npm"), "npm.cmd");
    assert.equal(resolveCommand("npx"), "npx.cmd");
    assert.equal(resolveCommand("yarn"), "yarn.cmd");
    assert.equal(resolveCommand("pnpm.cmd"), "pnpm.cmd");
    assert.equal(resolveCommand("node"), "node");
  });
});
