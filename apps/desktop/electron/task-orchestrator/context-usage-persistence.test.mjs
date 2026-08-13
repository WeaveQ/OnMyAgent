import assert from "node:assert/strict";
import test from "node:test";

import {
  contextUsageSignature,
  createContextUsagePersistenceState,
  observeContextUsageForPersistence,
} from "./context-usage-persistence.mjs";

const started = { usedTokens: 10, totalTokens: 100, percent: 10, source: "runtime", modelId: "model-1", observedAt: 10 };

test("initial usage signature prevents duplicate progress on the start observation", () => {
  const state = createContextUsagePersistenceState(started);
  const result = observeContextUsageForPersistence({ state, usage: { ...started, observedAt: 11 }, status: "running", leaseCurrent: true });
  assert.equal(result.persist, false);
  assert.equal(result.changed, false);
  assert.equal(result.state.lastSignature, contextUsageSignature(started));
});

test("usage changes persist only after the lease fence passes", () => {
  const state = createContextUsagePersistenceState(started);
  const stale = observeContextUsageForPersistence({ state, usage: { ...started, usedTokens: 20 }, status: "running", leaseCurrent: false });
  assert.equal(stale.persist, false);
  assert.equal(stale.state.lastSignature, state.lastSignature);
  const current = observeContextUsageForPersistence({ state, usage: { ...started, usedTokens: 20 }, status: "running", leaseCurrent: true });
  assert.equal(current.persist, true);
  assert.equal(current.reason, "changed");
});

test("terminal usage is persisted and missing status never advances progress", () => {
  const state = createContextUsagePersistenceState(started);
  const missing = observeContextUsageForPersistence({ state, usage: { ...started, usedTokens: 30 }, leaseCurrent: true });
  assert.equal(missing.persist, false);
  assert.equal(missing.reason, "status-missing");
  assert.equal(missing.state.lastSignature, state.lastSignature);
  const terminal = observeContextUsageForPersistence({ state, usage: started, status: "succeeded", leaseCurrent: true });
  assert.equal(terminal.persist, true);
  assert.equal(terminal.terminal, true);
});
