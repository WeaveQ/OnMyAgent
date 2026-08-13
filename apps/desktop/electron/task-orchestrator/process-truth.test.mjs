import assert from "node:assert/strict";
import test from "node:test";

import { classifyProcessTruth, includeProcessTruthRows } from "./process-truth.mjs";

test("unconfirmed cancellation, missing, and unknown do not become exited tombstones", () => {
  for (const input of [{ status: "cancelled" }, { status: "missing" }, { status: "unknown" }, { childState: "exited" }]) {
    const result = classifyProcessTruth(input);
    assert.equal(result.tombstone, false);
    assert.equal(result.status === "exited", false);
  }
});

test("only confirmed termination projects an exited tombstone", () => {
  assert.deepEqual(classifyProcessTruth({ status: "running", terminationConfirmed: true }), {
    status: "exited",
    tombstone: true,
    confirmed: true,
    reason: "confirmed-termination",
  });
  assert.equal(classifyProcessTruth({ childState: "exited", exitCode: 0 }).tombstone, true);
});

test("checker process rows are retained in the truth projection", () => {
  const rows = [{ attemptKind: "primary" }, { attemptKind: "checker" }, null, "worker"];
  assert.deepEqual(includeProcessTruthRows(rows), rows.slice(0, 2));
});
