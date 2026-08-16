import assert from "node:assert/strict";
import test from "node:test";

import { checkDocsCommandSot } from "./check-docs-command-sot.mjs";

test("shipped docs and skills match the live command and settings SoT", () => {
  const result = checkDocsCommandSot();
  assert.deepEqual(result.findings, []);
  assert.equal(result.ok, true);
});
