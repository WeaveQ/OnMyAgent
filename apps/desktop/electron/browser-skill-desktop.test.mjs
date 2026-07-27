import assert from "node:assert/strict";
import test from "node:test";

import {
  checkBrowserSkillStatus,
  resolveBskBinary,
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
  // On CI/dev machines without bsk, installed should be false.
  if (!status.installed) {
    assert.equal(status.ok, false);
    assert.equal(status.extensionConnected, false);
  }
});
