import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  browserUseRuntimeStatus,
  desktopRuntimeTarget,
} from "./browser-use-runtime-status.mjs";

test("maps desktop platforms to bundled runtime targets", () => {
  assert.equal(desktopRuntimeTarget("darwin", "arm64"), "aarch64-apple-darwin");
  assert.equal(desktopRuntimeTarget("darwin", "x64"), "x86_64-apple-darwin");
  assert.equal(desktopRuntimeTarget("win32", "x64"), "x86_64-pc-windows-msvc");
  assert.equal(desktopRuntimeTarget("linux", "arm64"), "aarch64-unknown-linux-gnu");
});

test("reads redacted Browser Use readiness from a bundled runtime", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "onmyagent-runtime-status-"));
  const targetRoot = path.join(root, "aarch64-apple-darwin");
  mkdirSync(path.join(targetRoot, "bin"), { recursive: true });
  writeFileSync(path.join(targetRoot, "bin", "browser-use"), "launcher");
  writeFileSync(
    path.join(targetRoot, "versions.json"),
    JSON.stringify({ browserUse: "0.13.4", browserHarness: "0.1.5" }),
  );

  assert.deepEqual(
    browserUseRuntimeStatus({ runtimeRoot: root, platform: "darwin", arch: "arm64" }),
    {
      ready: true,
      target: "embedded",
      browserUseVersion: "0.13.4",
      browserHarnessVersion: "0.1.5",
    },
  );
});
