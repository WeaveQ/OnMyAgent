import assert from "node:assert/strict";
import test from "node:test";

import { createRuntimeDomainHandlers } from "./runtime.mjs";

function createHarness() {
  const order = [];
  const runtimeManager = {
    engineStop: async () => { order.push("engine-stop"); },
    engineRestart: async () => { order.push("engine-restart"); },
    onmyagentServerRestart: async () => { order.push("server-restart"); },
  };
  const taskLifecycle = {
    assertNoActiveTaskWork: async (reason) => { order.push(`guard:${reason}`); },
    withNoActiveTaskWork: async (reason, action) => {
      order.push(`block:${reason}`);
      try {
        await taskLifecycle.assertNoActiveTaskWork(reason);
        return await action();
      } finally {
        order.push(`unblock:${reason}`);
      }
    },
    prepareDestructiveReset: async (reason) => { order.push(`prepare:${reason}`); },
  };
  const handlers = createRuntimeDomainHandlers({
    runtimeManager,
    taskLifecycle,
    scheduleDeferredReset: () => { order.push("schedule-deferred"); },
    queueAppExit: (appRef, code = 0) => { order.push(`exit-code:${code}`); appRef.exit(code); },
    app: {
      getPath: (name) => name === "userData" ? "/tmp/onmyagent-runtime-handler-user-data" : "/tmp",
      exit: (code) => order.push(`exit:${code}`),
    },
    rm: async (target) => { order.push(`rm:${target}`); },
    os: { homedir: () => "/tmp/home" },
    path: { join: (...parts) => parts.join("/"), resolve: (...parts) => parts.join("/") },
  });
  return { handlers, order, taskLifecycle };
}

test("engine and server lifecycle operations ask the Task Center guard before restart/stop", async () => {
  const { handlers, order } = createHarness();
  await handlers.engineStop({}, []);
  await handlers.engineRestart({}, [{}]);
  await handlers.onmyagentServerRestart({}, [{}]);
  assert.deepEqual(order, [
    "block:engine_stop", "guard:engine_stop", "engine-stop", "unblock:engine_stop",
    "block:engine_restart", "guard:engine_restart", "engine-restart", "unblock:engine_restart",
    "block:server_restart", "guard:server_restart", "server-restart", "unblock:server_restart",
  ]);
});

test("an active-work rejection prevents engine and server restart", async () => {
  const { handlers, order, taskLifecycle } = createHarness();
  taskLifecycle.assertNoActiveTaskWork = async () => {
    throw Object.assign(new Error("Task Center work is active"), { code: "TASK_CENTER_ACTIVE_WORK" });
  };
  await assert.rejects(handlers.engineRestart({}, [{}]), (error) => error?.code === "TASK_CENTER_ACTIVE_WORK");
  await assert.rejects(handlers.onmyagentServerRestart({}, [{}]), (error) => error?.code === "TASK_CENTER_ACTIVE_WORK");
  assert.deepEqual(order, [
    "block:engine_restart", "unblock:engine_restart",
    "block:server_restart", "unblock:server_restart",
  ]);
});

test("nuke drains the Task Supervisor before deleting userData and exiting", async () => {
  const { handlers, order } = createHarness();
  await handlers.nukeOnMyAgentAndOpencodeConfigAndExit({}, []);
  assert.deepEqual(order, [
    "prepare:full_nuke",
    "rm:/tmp/onmyagent-runtime-handler-user-data",
    "exit:0",
  ]);
});

test("failed nuke drain never deletes userData or exits", async () => {
  const { handlers, order, taskLifecycle } = createHarness();
  taskLifecycle.prepareDestructiveReset = async () => {
    throw Object.assign(new Error("drain failed"), { code: "TASK_DRAIN_FAILED" });
  };
  await assert.rejects(
    handlers.nukeOnMyAgentAndOpencodeConfigAndExit({}, []),
    (error) => error?.code === "TASK_DRAIN_FAILED",
  );
  assert.deepEqual(order, []);
});

test("full reset invokes the same destructive lifecycle boundary before any target delete", async () => {
  const { handlers, order } = createHarness();
  await handlers.resetOnMyAgentState({}, ["all"]);
  assert.equal(order[0], "prepare:full_reset");
  assert.match(order[1], /^rm:/);
  assert.ok(order.includes("schedule-deferred"));
  assert.ok(order.some((item) => /^exit:\d+$/.test(item)));
});

test("failed full-reset drain never deletes a target", async () => {
  const { handlers, order, taskLifecycle } = createHarness();
  taskLifecycle.prepareDestructiveReset = async () => {
    throw Object.assign(new Error("drain failed"), { code: "TASK_DRAIN_FAILED" });
  };
  await assert.rejects(
    handlers.resetOnMyAgentState({}, ["all"]),
    (error) => error?.code === "TASK_DRAIN_FAILED",
  );
  assert.deepEqual(order, []);
});
