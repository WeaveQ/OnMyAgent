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
  const storedRuns = new Map();
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
  const store = {
    saveRun(run) {
      storedRuns.set(run.runId, structuredClone(run));
      return run;
    },
    getRun(runId) {
      const run = storedRuns.get(runId);
      return run ? structuredClone(run) : null;
    },
    listBySession(sessionId) {
      return [...storedRuns.values()]
        .filter((run) => run.sessionId === sessionId)
        .map((run) => structuredClone(run));
    },
  };
  const runtime = createBrowserUseAgentRuntime({
    browserEnvironment,
    modelGateway,
    store,
    spawnRunner({ env }) {
      const child = createChild();
      child.environment = env;
      children.push(child);
      return child;
    },
  });
  return { children, releasedOwners, releasedRuns, runtime, storedRuns };
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

test("forwards the selected interface language to the upstream runner", async () => {
  const harness = createHarness();
  await harness.runtime.start({ task: "打开网页", ownerId: "localized", language: "zh" });
  const child = harness.children[0];
  let input = "";
  child.stdin.on("data", (chunk) => { input += chunk.toString("utf8"); });
  await tick();

  assert.equal(JSON.parse(input.trim()).language, "zh");
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

test("normalizes and persists ordered public events for a session", async () => {
  const harness = createHarness();
  const started = await harness.runtime.start({
    task: "inspect",
    ownerId: "expert:session-events",
    sessionId: "session-events",
    userMessageId: "message-events",
  });
  const child = harness.children[0];
  child.stdout.write(`${JSON.stringify({
    id: "runner-narration",
    type: "narration",
    step: 1,
    text: "Open the page",
    nextGoal: "Open the page",
    thinking: "private thought",
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    id: "runner-operation",
    type: "operation_started",
    operationId: "operation-1",
    step: 1,
    actions: [{ name: "go_to_url", params: { url: "https://example.com" } }],
    actionCount: 1,
    url: "about:blank",
    title: "New Tab",
  })}\n`);
  child.stdout.write(`${JSON.stringify({
    id: "runner-operation",
    type: "operation_started",
    operationId: "operation-1",
    step: 1,
  })}\n`);
  await tick();

  const active = harness.runtime.status(started.runId);
  assert.equal(active.sessionId, "session-events");
  assert.equal(active.userMessageId, "message-events");
  assert.deepEqual(active.events.map((event) => event.sequence), [1, 2]);
  assert.equal(new Set(active.events.map((event) => event.id)).size, 2);
  assert.doesNotMatch(JSON.stringify(active), /private thought|thinking/);
  assert.deepEqual(harness.runtime.history("session-events"), [active]);
  assert.deepEqual(harness.storedRuns.get(started.runId), active);

  child.stdout.write(`${JSON.stringify({ type: "done", result: "Example Domain" })}\n`);
  child.stdout.write(`${JSON.stringify({
    type: "operation_progress",
    operationId: "operation-late",
    action: { name: "click", params: { index: 1 } },
  })}\n`);
  await tick();
  const completed = harness.runtime.status(started.runId);
  assert.equal(completed.status, "completed");
  assert.equal(completed.events.at(-1).type, "done");
  assert.equal(completed.events.some((event) => event.operationId === "operation-late"), false);
});

test("persists a safe model diagnostic emitted by the upstream runner", async () => {
  const harness = createHarness();
  const started = await harness.runtime.start({ task: "inspect", ownerId: "diagnostic" });
  const child = harness.children[0];
  child.stdout.write(`${JSON.stringify({
    type: "model_error",
    errorType: "RuntimeError",
    error: "OpenCode model returned no structured output",
  })}\n`);
  await tick();

  assert.match(
    harness.runtime.status(started.runId).events.at(-1).message,
    /RuntimeError: OpenCode model returned no structured output/,
  );
  await harness.runtime.dispose();
});

test("normalizes a public model update without persisting private reasoning", async () => {
  const harness = createHarness();
  const started = await harness.runtime.start({ task: "inspect", ownerId: "model-update" });
  const child = harness.children[0];
  child.stdout.write(`${JSON.stringify({
    type: "model_update",
    step: 2,
    evaluation: "The previous click opened the detail page",
    nextGoal: "Read the visible title",
    actions: [{ name: "extract", params: { selector: "h1" } }],
    raw: {
      evaluationPreviousGoal: "The previous click opened the detail page",
      nextGoal: "Read the visible title",
      actions: [{ name: "extract", params: { selector: "h1" } }],
      thinking: "private chain of thought",
      memory: "private working memory",
    },
    thinking: "private top-level thought",
  })}\n`);
  await tick();

  const event = harness.runtime.status(started.runId).events.at(-1);
  assert.deepEqual(event, {
    type: "model_update",
    step: 2,
    evaluation: "The previous click opened the detail page",
    nextGoal: "Read the visible title",
    actions: [{ name: "extract", params: { selector: "h1" } }],
    raw: {
      evaluationPreviousGoal: "The previous click opened the detail page",
      nextGoal: "Read the visible title",
      actions: [{ name: "extract", params: { selector: "h1" } }],
    },
    id: `${started.runId}:1`,
    runId: started.runId,
    sequence: 1,
    timestamp: event.timestamp,
  });
  assert.doesNotMatch(JSON.stringify(harness.storedRuns.get(started.runId)), /private|thinking|memory/);
  await harness.runtime.dispose();
});

test("fails instead of reporting success when the runner returns an empty result", async () => {
  const harness = createHarness();
  const started = await harness.runtime.start({ task: "inspect", ownerId: "empty-result" });
  const child = harness.children[0];
  child.stdout.write(`${JSON.stringify({ type: "done", result: null })}\n`);
  await tick();

  const failed = harness.runtime.status(started.runId);
  assert.equal(failed.status, "failed");
  assert.match(failed.error, /without a final result/i);
  assert.equal(failed.events.at(-1).type, "error");
});

test("allows parallel sessions but rejects a second active run in the same session", async () => {
  const harness = createHarness();
  await harness.runtime.start({ task: "A", ownerId: "owner-a", sessionId: "session-a" });
  await assert.rejects(
    harness.runtime.start({ task: "A2", ownerId: "owner-a2", sessionId: "session-a" }),
    /already active/,
  );
  await harness.runtime.start({ task: "B", ownerId: "owner-b", sessionId: "session-b" });
  assert.equal(harness.children.length, 2);
  await harness.runtime.dispose();
});
