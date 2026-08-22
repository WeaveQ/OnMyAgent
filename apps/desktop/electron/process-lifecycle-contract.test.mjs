import assert from "node:assert/strict";
import test from "node:test";

import { createProcessLifecycleContract } from "./process-lifecycle-contract.mjs";

test("process lifecycle contract exposes shared health and teardown states", async () => {
  let clock = 10;
  const lifecycle = createProcessLifecycleContract({ name: "test-runtime", now: () => clock++ });
  assert.equal(lifecycle.state(), "idle");
  await lifecycle.run("boot", async () => ({ ok: true }));
  assert.equal(lifecycle.state(), "healthy");
  const stopped = await lifecycle.stop("quit", async () => undefined);
  assert.deepEqual(stopped, undefined);
  assert.equal(lifecycle.snapshot().state, "stopped");
  assert.equal(lifecycle.snapshot().operation, "quit");
});
test("process lifecycle contract records structured launch failures", async () => {
  const lifecycle = createProcessLifecycleContract({ name: "test-runtime", now: () => 1 });
  await assert.rejects(
    lifecycle.run("boot", async () => { throw Object.assign(new Error("failed"), { code: "BOOT_FAILED" }); }),
    /failed/,
  );
  assert.deepEqual(lifecycle.snapshot().lastError, { code: "BOOT_FAILED", message: "failed" });
  assert.equal(lifecycle.state(), "error");
});
