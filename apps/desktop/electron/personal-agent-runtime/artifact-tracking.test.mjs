import assert from "node:assert/strict";
import test from "node:test";

import { normalizeRunTimeoutMs } from "./artifact-tracking.mjs";

test("normalizeRunTimeoutMs keeps overnight turns within a finite 12-hour ceiling", () => {
  const twelveHours = 12 * 60 * 60 * 1000;
  assert.equal(normalizeRunTimeoutMs(undefined), twelveHours);
  assert.equal(normalizeRunTimeoutMs(60_000), 60_000);
  assert.equal(normalizeRunTimeoutMs(24 * 60 * 60 * 1000), twelveHours);
});
