import assert from "node:assert/strict";
import test from "node:test";

import {
  BROWSER_SKILL_INSTALL_COMMAND,
  browserSkillInstallCommand,
  checkBrowserSkillStatus,
  resolveBskBinary,
  windowsBskCandidates,
} from "./browser-skill-desktop.mjs";

test("resolveBskBinary returns a candidate path or PATH name", () => {
  const resolved = resolveBskBinary();
  assert.ok(resolved.path);
  assert.ok(
    resolved.source === "path" ||
      resolved.source === "home-local" ||
      resolved.source === "missing",
  );
});

test("resolveBskBinary prefers Windows .exe/.cmd user-local bins", () => {
  const home = "C:\\Users\\me";
  const candidates = windowsBskCandidates(home, { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" });
  assert.ok(candidates.some((item) => item.replaceAll("/", "\\").toLowerCase().endsWith("\\bsk.exe")));
  assert.ok(candidates.some((item) => item.replaceAll("/", "\\").toLowerCase().endsWith("\\bsk.cmd")));
  const resolved = resolveBskBinary({
    platform: "win32",
    home,
    env: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
    exists: (candidate) => candidate.replaceAll("/", "\\").toLowerCase().endsWith("\\.local\\bin\\bsk.exe"),
  });
  assert.match(resolved.path.replaceAll("/", "\\"), /\\bsk\.exe$/i);
  assert.equal(resolved.source, "home-local");
});

test("install one-liner is stable", () => {
  const unix = browserSkillInstallCommand("darwin");
  assert.match(unix, /install\.sh/);
  assert.match(unix, /bsk doctor/);
  const win = browserSkillInstallCommand("win32");
  assert.match(win, /bsk doctor/);
  assert.doesNotMatch(win, /install\.sh/);
  assert.doesNotMatch(win, /curl[\s\S]*\|\s*sh/);
  assert.match(BROWSER_SKILL_INSTALL_COMMAND, /bsk doctor/);
});

test("checkBrowserSkillStatus returns a stable shape when bsk is missing", async () => {
  const status = await checkBrowserSkillStatus();
  assert.equal(typeof status.ok, "boolean");
  assert.equal(typeof status.installed, "boolean");
  assert.equal(typeof status.extensionConnected, "boolean");
  assert.ok("version" in status);
  assert.ok(typeof status.message === "string" && status.message.length > 0);
  assert.ok(status.installCliUrl.includes("BrowserSkill"));
  assert.ok(status.chromeWebStoreUrl.includes("chromewebstore"));
  assert.ok(status.docsUrl.includes("BrowserSkill"));
  assert.match(String(status.installCommand ?? ""), /bsk doctor/);
  if (process.platform === "win32") {
    assert.doesNotMatch(String(status.installCommand ?? ""), /install\.sh|curl[\s\S]*\|\s*sh/);
  }
  // On CI/dev machines without bsk, installed should be false.
  if (!status.installed) {
    assert.equal(status.ok, false);
    assert.equal(status.extensionConnected, false);
  }
});
