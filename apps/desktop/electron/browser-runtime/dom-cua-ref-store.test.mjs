import assert from "node:assert/strict";
import test from "node:test";

import { createDomCuaRefStore } from "./dom-cua-ref-store.mjs";

test("DOM-CUA refs are valid only for the latest observation generation", () => {
  const store = createDomCuaRefStore();
  const first = store.observe("tab-1", [{ nodeId: 10 }, { nodeId: 11 }]);
  assert.equal(store.resolve("tab-1", first.nodes[0].ref).nodeId, 10);

  store.observe("tab-1", [{ nodeId: 12 }]);

  assert.throws(() => store.resolve("tab-1", first.nodes[0].ref), /stale/i);
});

test("DOM-CUA refs cannot cross tabs", () => {
  const store = createDomCuaRefStore();
  const observation = store.observe("tab-1", [{ nodeId: 10 }]);

  assert.throws(() => store.resolve("tab-2", observation.nodes[0].ref), /stale/i);
});

test("DOM-CUA invalidation makes all previous refs stale", () => {
  const store = createDomCuaRefStore();
  const observation = store.observe("tab-1", [{ nodeId: 10 }]);
  store.invalidate("tab-1");

  assert.throws(() => store.resolve("tab-1", observation.nodes[0].ref), /stale/i);
});
