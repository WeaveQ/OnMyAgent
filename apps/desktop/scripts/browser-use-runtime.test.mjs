import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  BROWSER_HARNESS_VERSION,
  BROWSER_USE_VERSION,
  browserUseInstallArgs,
  browserUseLauncherContents,
  browserUseManifestFields,
  resolveBundledBrowserUseRuntime,
} from "./browser-use-runtime.mjs";

test("pins the Browser Use distributions recorded in the runtime manifest", () => {
  assert.equal(BROWSER_USE_VERSION, "0.13.4");
  assert.equal(BROWSER_HARNESS_VERSION, "0.1.5");
  assert.deepEqual(browserUseManifestFields(), {
    browserUse: "0.13.4",
    browserHarness: "0.1.5",
  });
});

test("installs the CLI into bundled Python without downloading a browser", () => {
  assert.deepEqual(browserUseInstallArgs(), [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--no-cache-dir",
    "browser-use[cli]==0.13.4",
  ]);
});

test("generates relocatable launchers that disable telemetry", () => {
  const unix = browserUseLauncherContents("darwin");
  assert.match(unix, /dirname "\$0"/);
  assert.match(unix, /ANONYMIZED_TELEMETRY=false/);
  assert.match(unix, /from browser_use\.cli import main/);

  const windows = browserUseLauncherContents("win32");
  assert.match(windows, /%~dp0/);
  assert.match(windows, /ANONYMIZED_TELEMETRY=false/);
  assert.match(windows, /python\.exe/);
});

test("reports a ready runtime only when Python and the launcher exist", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "onmyagent-browser-use-runtime-"));
  const targetRoot = path.join(root, "aarch64-apple-darwin");
  mkdirSync(path.join(targetRoot, "python", "bin"), { recursive: true });
  mkdirSync(path.join(targetRoot, "bin"), { recursive: true });
  writeFileSync(path.join(targetRoot, "python", "bin", "python3"), "python");
  writeFileSync(path.join(targetRoot, "bin", "browser-use"), "launcher");

  assert.deepEqual(resolveBundledBrowserUseRuntime(targetRoot, "darwin"), {
    ready: true,
    pythonPath: path.join(targetRoot, "python", "bin", "python3"),
    launcherPath: path.join(targetRoot, "bin", "browser-use"),
    browserUseVersion: "0.13.4",
    browserHarnessVersion: "0.1.5",
  });

  assert.equal(
    resolveBundledBrowserUseRuntime(path.join(root, "missing"), "darwin").ready,
    false,
  );
});
