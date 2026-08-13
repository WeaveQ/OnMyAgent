import assert from "node:assert/strict";
import test from "node:test";

import { createTaskLifecycleCoordinator } from "./task-lifecycle-coordinator.mjs";

function createHarness(overrides = {}) {
  const order = [];
  let releaseCount = 0;
  const taskOrchestrator = {
    blockMutations(reason) {
      order.push(`block:${reason}`);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        releaseCount += 1;
        order.push(`release:${reason}`);
      };
    },
    async awaitMutationsIdle() { order.push("mutations-idle"); },
    async getActiveWork() {
      order.push("active-work");
      return { active: false, activeCount: 0, tasks: [], truncated: false };
    },
    stopWatchdog() { order.push("watchdog-stop"); },
    startWatchdog() { order.push("watchdog-start"); },
    async pauseAllAndDrain(reason) { order.push(`drain:${reason}`); },
    ...overrides,
  };
  const coordinator = createTaskLifecycleCoordinator({
    taskOrchestrator,
    readAdditionalActiveWork: overrides.readAdditionalActiveWork,
    blockAdditionalWork(reason) {
      order.push(`additional-block:${reason}`);
      return () => order.push(`additional-release:${reason}`);
    },
    async stopDependentRuntimes(reason) { order.push(`dependents-stop:${reason}`); },
    onDrained(reason) { order.push(`drained:${reason}`); },
  });
  return { coordinator, order, taskOrchestrator, releaseCount: () => releaseCount };
}

test("engine lifecycle is fenced while accepted mutations drain, then queries durable active work", async () => {
  const { coordinator, order } = createHarness();
  const result = await coordinator.withNoActiveTaskWork("engine_restart", async () => {
    order.push("engine-restart");
    return "restarted";
  });
  assert.equal(result, "restarted");
  assert.deepEqual(order, [
    "block:engine_restart",
    "additional-block:engine_restart",
    "mutations-idle",
    "active-work",
    "engine-restart",
    "additional-release:engine_restart",
    "release:engine_restart",
  ]);
  assert.equal(coordinator.lifecycleStatus(), null);
});

test("typed active-work rejection prevents engine lifecycle and releases the mutation fence", async () => {
  const { coordinator, order, releaseCount } = createHarness({
    async getActiveWork() {
      order.push("active-work");
      return {
        active: true,
        activeCount: 1,
        tasks: [{ taskId: "task-active" }],
        truncated: false,
      };
    },
  });
  await assert.rejects(
    coordinator.withNoActiveTaskWork("server_restart", async () => order.push("server-restart")),
    (error) => error?.code === "LOCAL_AGENT_ACTIVE_WORK"
      && error?.operation === "server_restart"
      && error?.taskIds?.[0] === "task-active",
  );
  assert.equal(order.includes("server-restart"), false);
  assert.equal(releaseCount(), 1);
  assert.equal(coordinator.lifecycleStatus(), null);
});

test("active interactive or channel provider work blocks engine lifecycle", async () => {
  const { coordinator, order } = createHarness({
    readAdditionalActiveWork: async () => ({
      active: true,
      activeCount: 1,
      items: [{ runId: "personal-channel-run", status: "running" }],
    }),
  });
  await assert.rejects(
    coordinator.withNoActiveTaskWork("engine_restart", async () => order.push("must-not-run")),
    (error) => error?.code === "LOCAL_AGENT_ACTIVE_WORK"
      && error?.runIds?.[0] === "personal-channel-run"
      && error?.activeCount === 1,
  );
  assert.equal(order.includes("must-not-run"), false);
});

test("failed destructive drain restores watchdog, releases its fence, and remains retryable", async () => {
  let drains = 0;
  const { coordinator, order, releaseCount } = createHarness({
    async pauseAllAndDrain(reason) {
      drains += 1;
      order.push(`drain:${reason}:${drains}`);
      if (drains === 1) {
        throw Object.assign(new Error("temporary drain failure"), { code: "TASK_DRAIN_FAILED" });
      }
    },
  });

  await assert.rejects(
    coordinator.prepareDestructiveReset("full_reset"),
    (error) => error?.code === "TASK_DRAIN_FAILED",
  );
  assert.equal(coordinator.destructiveInFlight(), false);
  assert.equal(coordinator.lifecycleStatus(), null);
  assert.equal(releaseCount(), 1);
  assert.deepEqual(order.slice(0, 6), [
    "block:full_reset",
    "additional-block:full_reset",
    "watchdog-stop",
    "mutations-idle",
    "drain:full_reset:1",
    "additional-release:full_reset",
  ]);
  assert.deepEqual(order.slice(6, 8), [
    "release:full_reset",
    "watchdog-start",
  ]);

  assert.deepEqual(await coordinator.prepareDestructiveReset("full_reset"), {
    ok: true,
    reason: "full_reset",
  });
  assert.equal(drains, 2);
  assert.equal(releaseCount(), 2);
  assert.deepEqual(coordinator.lifecycleStatus(), {
    operation: "full_reset",
    destructive: true,
  });
});

test("successful destructive preparation drains before stopping dependent writers and is idempotent", async () => {
  const { coordinator, order } = createHarness();
  const first = await coordinator.prepareDestructiveReset("full_nuke");
  const second = await coordinator.prepareDestructiveReset("ignored-after-first");
  assert.strictEqual(second, first);
  assert.deepEqual(order, [
    "block:full_nuke",
    "additional-block:full_nuke",
    "watchdog-stop",
    "mutations-idle",
    "drain:full_nuke",
    "dependents-stop:full_nuke",
    "drained:full_nuke",
    "release:full_nuke",
  ]);
});
