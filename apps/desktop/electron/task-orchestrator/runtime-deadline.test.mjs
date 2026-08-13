import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withRuntimeDeadline } from "./runtime-deadline.mjs";

describe("Task Center runtime call deadline", () => {
  it("returns the runtime result and clears the watchdog", async () => {
    let cleared = false;
    const result = await withRuntimeDeadline("catalog", 50, async () => "ready", {
      setTimer: () => ({ unref() {} }),
      clearTimer: () => { cleared = true; },
    });
    assert.equal(result, "ready");
    assert.equal(cleared, true);
  });

  it("preserves a runtime rejection", async () => {
    await assert.rejects(
      withRuntimeDeadline("create conversation", 50, async () => {
        throw Object.assign(new Error("runtime unavailable"), { code: "RUNTIME_DOWN" });
      }),
      (error) => error.code === "RUNTIME_DOWN",
    );
  });

  it("fails with a stable diagnostic when a runtime call never settles", async () => {
    await assert.rejects(
      withRuntimeDeadline("Personal getRun", 5, () => new Promise(() => undefined)),
      (error) => error.code === "TASK_RUNTIME_CALL_TIMEOUT"
        && error.deadlineMs === 5
        && /Personal getRun timed out after 5ms/.test(error.message),
    );
  });
});
