import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const helperPath = path.resolve(
  import.meta.dirname,
  "../../resources/browser-use/agent_helpers.py",
);

test("ships broker-backed embedded browser helper overrides", () => {
  const source = readFileSync(helperPath, "utf8");
  assert.match(source, /^def new_tab\(/m);
  assert.match(source, /^def ensure_real_tab\(/m);
  assert.match(source, /^def close_tab\(/m);
  assert.match(source, /ONMYAGENT_BROWSER_BROKER_URL/);
  assert.match(source, /ONMYAGENT_BROWSER_BROKER_TOKEN/);
  assert.doesNotMatch(source, /Target\.createTarget/);
});
