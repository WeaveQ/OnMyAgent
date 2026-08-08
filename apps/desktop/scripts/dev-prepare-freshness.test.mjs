import assert from "node:assert/strict";
import test from "node:test";
import { shouldForceDevPreparation } from "./dev-prepare-freshness.mjs";

function fromTimes(times) {
  return (path) => times[path] ?? null;
}

test("forces preparation when an artifact is missing", () => {
  assert.equal(
    shouldForceDevPreparation({
      artifactPaths: ["artifact"],
      inputPaths: ["source"],
      getNewest: fromTimes({ source: 10 }),
    }),
    true,
  );
});

test("forces preparation when an input is newer than an artifact", () => {
  assert.equal(
    shouldForceDevPreparation({
      artifactPaths: ["artifact"],
      inputPaths: ["source", "lock"],
      getNewest: fromTimes({ artifact: 10, source: 11, lock: 9 }),
    }),
    true,
  );
});

test("reuses fresh artifacts", () => {
  assert.equal(
    shouldForceDevPreparation({
      artifactPaths: ["artifact-a", "artifact-b"],
      inputPaths: ["source", "constants"],
      getNewest: fromTimes({ "artifact-a": 12, "artifact-b": 13, source: 11, constants: 10 }),
    }),
    false,
  );
});

test("explicit force always wins", () => {
  assert.equal(
    shouldForceDevPreparation({
      artifactPaths: ["artifact"],
      inputPaths: ["source"],
      force: true,
      getNewest: fromTimes({ artifact: 100, source: 1 }),
    }),
    true,
  );
});
