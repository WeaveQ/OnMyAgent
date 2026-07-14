import assert from "node:assert/strict";
import test from "node:test";

import markerContract from "./browser-tab-marker.cjs";

const {
  browserTabAdditionalArguments,
  browserTabIdFromArgv,
  browserTabMarker,
  normalizeBrowserTabOwner,
} = markerContract;

test("round trips an embedded browser tab id through preload arguments", () => {
  const args = browserTabAdditionalArguments("tab_alpha:1");
  assert.deepEqual(args, ["--onmyagent-browser-tab-id=tab_alpha%3A1"]);
  assert.equal(browserTabIdFromArgv(["electron", ...args]), "tab_alpha:1");
  assert.equal(browserTabMarker("tab_alpha:1"), "onmyagent-browser:tab_alpha:1");
});

test("normalizes opaque owner ids and rejects unsafe values", () => {
  assert.equal(normalizeBrowserTabOwner(" conversation:abc-123 "), "conversation:abc-123");
  assert.equal(normalizeBrowserTabOwner(""), null);
  assert.equal(normalizeBrowserTabOwner("owner with spaces"), null);
  assert.equal(normalizeBrowserTabOwner("x".repeat(129)), null);
});
