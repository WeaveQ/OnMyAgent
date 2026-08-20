import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeEventPublisher } from "./runtime-events.mjs";

test("runtime event publisher emits catalog invalidation without a run identity", () => {
  const events = [];
  const publisher = createRuntimeEventPublisher({ onEvent: (event) => events.push(event) });
  publisher.invalidateCatalog("/workspace/example");
  assert.deepEqual(events, [{
    type: "catalog.invalidated",
    runId: null,
    workspaceRoot: "/workspace/example",
    conversationId: null,
    status: "completed",
    updatedAt: events[0].updatedAt,
  }]);
});
