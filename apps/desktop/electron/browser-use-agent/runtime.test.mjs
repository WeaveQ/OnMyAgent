import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createBrowserUseAgentRuntime } from "./runtime.mjs";

function tick() {
  return new Promise((resolve) => setImmediate(resolve));
}

class FakeChild extends EventEmitter {
  constructor() {
    super();
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.killed = false;
    this.environment = {};
  }

  kill() {
    this.killed = true;
    this.emit("close", null, "SIGTERM");
  }
}

function createChild() {
  return new FakeChild();
}

function createHarness() {
  const children = [];
  const releasedRuns = [];
  const releasedOwners = [];
  const browserEnvironment = {
    environmentForOwner(ownerId) {
      return {
        BU_CDP_URL: "http://127.0.0.1:9823",
        ONMYAGENT_BROWSER_BROKER_TOKEN: `browser-${ownerId}`,
      };
    },
    releaseOwner(ownerId, options) {
      releasedOwners.push({ ownerId, options });
      return [];
    },
  };
  const modelGateway = {
    async start() {},
    environmentForRun({ ownerId, model }) {
      return {
        ONMYAGENT_MODEL_GATEWAY_URL: "http://127.0.0.1:9999",
        ONMYAGENT_MODEL_GATEWAY_TOKEN: `model-${ownerId}-${model?.modelID ?? "inherit"}`,
      };
    },
    releaseRun(environment) {
      releasedRuns.push(environment.ONMYAGENT_MODEL_GATEWAY_TOKEN);
    },
  };
  const runtime = createBrowserUseAgentRuntime({
    browserEnvironment,
    modelGateway,
    spawnRunner({ env }) {
      const child = createChild();
      child.environment = env;
      children.push(child);
      return child;
    },
  });
  return { children, releasedOwners, releasedRuns, runtime };
}

test("runs three isolated owners while inheriting or overriding the selected model", async () => {
  const harness = createHarness();
  const starts = await Promise.all([
    harness.runtime.start({ task: "A", ownerId: "a", model: { providerID: "openai", modelID: "gpt-a" } }),
    harness.runtime.start({ task: "B", ownerId: "b", model: { providerID: "openai", modelID: "gpt-b" } }),
    harness.runtime.start({ task: "C", ownerId: "c" }),
  ]);
  assert.equal(new Set(starts.map((item) => item.runId)).size, 3);
  assert.equal(harness.children.length, 3);
  assert.match(harness.children[0].environment.ONMYAGENT_MODEL_GATEWAY_TOKEN, /gpt-a$/);
  assert.match(harness.children[1].environment.ONMYAGENT_MODEL_GATEWAY_TOKEN, /gpt-b$/);
  assert.match(harness.children[2].environment.ONMYAGENT_MODEL_GATEWAY_TOKEN, /inherit$/);
  assert.notEqual(
    harness.children[0].environment.ONMYAGENT_BROWSER_BROKER_TOKEN,
    harness.children[1].environment.ONMYAGENT_BROWSER_BROKER_TOKEN,
  );
  await harness.runtime.dispose();
});

test("pauses for approval and resumes the same upstream runner", async () => {
  const harness = createHarness();
  const started = await harness.runtime.start({ task: "publish", ownerId: "approval" });
  const child = harness.children[0];
  let input = "";
  child.stdin.on("data", (chunk) => { input += chunk.toString("utf8"); });
  child.stdout.write(`${JSON.stringify({ type: "ready", model: "selected" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "approval",
    approvalId: "approval-1",
    action: { click: { index: 7 } },
    summary: "发布",
  })}\n`);
  await tick();
  assert.equal(harness.runtime.status(started.runId).status, "pending_approval");
  assert.equal(harness.runtime.status(started.runId).pendingApprovals[0].id, "approval-1");

  const result = await harness.runtime.approve({
    runId: started.runId,
    approvalId: "approval-1",
    decision: "accept",
  });
  assert.equal(result.ok, true);
  assert.match(input, /"type":"approval_response"/);
  assert.match(input, /"decision":"accept"/);
  assert.equal(harness.runtime.status(started.runId).status, "running");

  child.stdout.end(`${JSON.stringify({ type: "done", result: "published" })}\n`);
  child.emit("close", 0, null);
  await tick();
  assert.equal(harness.runtime.status(started.runId).status, "completed");
  assert.equal(harness.runtime.status(started.runId).result, "published");
  assert.equal(harness.releasedRuns.length, 1);
  assert.deepEqual(harness.releasedOwners, [{ ownerId: "approval", options: { closeTabs: true } }]);
});

test("cancels a runner, revokes tokens, and can retain its tabs", async () => {
  const harness = createHarness();
  const started = await harness.runtime.start({ task: "wait", ownerId: "retained", retainTabs: true });
  const cancelled = await harness.runtime.cancel(started.runId);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(harness.children[0].killed, true);
  assert.equal(harness.releasedRuns.length, 1);
  assert.deepEqual(harness.releasedOwners, [{ ownerId: "retained", options: { closeTabs: false } }]);
  assert.doesNotMatch(JSON.stringify(cancelled), /9823|browser-retained|model-retained/);
});
