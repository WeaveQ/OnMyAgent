import assert from "node:assert/strict";
import test from "node:test";

import { awaitRuntimeBootstrapForSupervisor } from "./task-background-runtime.mjs";

test("Supervisor recovery waits for a normal runtime boot but cannot hang behind it forever", async () => {
  assert.deepEqual(await awaitRuntimeBootstrapForSupervisor(Promise.resolve()), { ready: true });
  const pending = new Promise(() => undefined);
  assert.deepEqual(await awaitRuntimeBootstrapForSupervisor(pending, 5), { ready: false, timedOut: true });
});
