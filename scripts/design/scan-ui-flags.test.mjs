import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { scanUiFlags } from "./scan-ui-flags.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("scanUiFlags: no pill-xs and nested ring-0 stays allowlisted", () => {
  const flags = scanUiFlags(repoRoot);
  assert.equal(
    flags.pillCtas.filter((hit) => hit.snippet === 'size="pill-xs"').length,
    0,
    "Button size=pill-xs must stay deleted",
  );
  assert.equal(flags.pillCtas.length, 0, "rounded-full CTAs outside §11 must stay off Button");
  assert.equal(flags.shadows.length, 0, "decorative shadow-* utilities must stay off TS/TSX");
  assert.equal(
    flags.ringZero.length,
    0,
    "focus-visible:ring-0 on chrome must stay on the nested-field allowlist",
  );
});

test("scanUiFlags: hex className hits stay off page chrome", () => {
  const flags = scanUiFlags(repoRoot);
  assert.equal(flags.hex.length, 0, "page className hex must stay on the §11 allowlist");
});
