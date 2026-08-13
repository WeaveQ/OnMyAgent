import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { afterEach, describe, it } from "node:test";

import { createTaskControlMcpBridge } from "./runner.mjs";
import { createTaskOrchestrator } from "./index.mjs";
import { createTaskOrchestratorStore } from "./store-factory.mjs";
import { cleanupDirectories, contract, createRuntime, temporaryDirectory } from "./v2-test-helpers.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await cleanupDirectories(temporaryDirectories.splice(0));
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for MCP bridge state");
    await delay(5);
  }
}

async function readJsonIfPresent(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function openMcpServer(descriptor) {
  const child = spawn(descriptor.command, descriptor.args, {
    env: { ...process.env, ...(descriptor.env ?? {}) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let requestId = 0;
  const pending = new Map();
  const output = readline.createInterface({ input: child.stdout });
  output.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        waiter.resolve(message);
      }
    } catch {
      // Ignore provider diagnostics; MCP responses remain JSON-RPC lines.
    }
  });
  child.on("exit", (code, signal) => {
    for (const waiter of pending.values()) waiter.reject(new Error(`MCP process exited (${code ?? signal})`));
    pending.clear();
  });
  return {
    request(method, params = {}) {
      const id = ++requestId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    notify(method, params = {}) {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
    },
    close() {
      output.close();
      child.kill("SIGTERM");
    },
  };
}

describe("Task Center v2 provider control bridge", () => {
  it("backs off idle polling and recovers a request even when the watch event is missed", async () => {
    const root = await temporaryDirectory("task-v2-mcp-poll-fallback-");
    temporaryDirectories.push(root);
    const queueRoot = `${root}/mcp/poll-fallback`;
    let watcherClosed = false;
    const bridge = await createTaskControlMcpBridge({
      queueRoot,
      token: "poll-token",
      pollMinMs: 5,
      pollMaxMs: 40,
      watchRequests: () => ({
        on() { return this; },
        unref() {},
        close() { watcherClosed = true; },
      }),
      invoke: async (tool, args) => ({ tool, args }),
    });
    try {
      await waitUntil(() => bridge.pollingStats().idleDelay === 40);
      const idlePollCount = bridge.pollingStats().pollCount;
      await delay(90);
      assert.ok(bridge.pollingStats().pollCount - idlePollCount <= 3, "idle polling did not remain backed off");

      const request = { id: "missed-watch", token: "poll-token", tool: "list_agents", arguments: { source: "fallback" } };
      await writeFile(`${queueRoot}/requests/${request.id}.json`, JSON.stringify(request), "utf8");
      const responsePath = `${queueRoot}/responses/${request.id}.json`;
      await waitUntil(async () => (await readJsonIfPresent(responsePath)) !== null);
      assert.deepEqual(await readJsonIfPresent(responsePath), {
        id: request.id,
        result: { tool: "list_agents", args: { source: "fallback" } },
      });
      assert.equal(bridge.pollingStats().watchWakeups, 0);
    } finally {
      await bridge.close();
      assert.equal(watcherClosed, true);
    }
  });

  it("quarantines a malformed request once instead of rereading it forever", async () => {
    const root = await temporaryDirectory("task-v2-mcp-poison-");
    temporaryDirectories.push(root);
    const queueRoot = `${root}/mcp/poison`;
    const bridge = await createTaskControlMcpBridge({
      queueRoot,
      token: "poison-token",
      pollMinMs: 5,
      pollMaxMs: 20,
      watchRequests: () => ({ on() { return this; }, unref() {}, close() {} }),
      invoke: async () => { throw new Error("poison request must not invoke"); },
    });
    try {
      await writeFile(`${queueRoot}/requests/poison.json`, "{broken", "utf8");
      await waitUntil(() => bridge.pollingStats().poisonRequests === 1);
      await delay(50);
      assert.equal(bridge.pollingStats().poisonRequests, 1);
      assert.deepEqual(await readdir(`${queueRoot}/requests`), []);
      assert.deepEqual(await readdir(`${queueRoot}/processing`), []);
    } finally {
      await bridge.close();
    }
  });

  it("fails a crash-window claimed request closed with an unknown durable outcome instead of replaying", async () => {
    const root = await temporaryDirectory("task-v2-mcp-recover-unknown-");
    temporaryDirectories.push(root);
    const queueRoot = `${root}/mcp/recover`;
    await mkdir(`${queueRoot}/processing`, { recursive: true });
    await writeFile(`${queueRoot}/processing/claimed.json`, JSON.stringify({
      id: "claimed", token: "recover-token", tool: "spawn_agent", arguments: { workerProfileId: "worker", prompt: "do not replay" },
    }), "utf8");
    let invokes = 0;
    const bridge = await createTaskControlMcpBridge({
      queueRoot,
      token: "recover-token",
      pollMinMs: 5,
      pollMaxMs: 20,
      invoke: async () => { invokes += 1; return { replayed: true }; },
    });
    try {
      assert.equal(bridge.pollingStats().unknownOutcomeRecoveries, 1);
      assert.equal(invokes, 0);
      assert.deepEqual(await readJsonIfPresent(`${queueRoot}/responses/claimed.json`), {
        id: "claimed",
        error: "Task control request outcome is unknown after Supervisor recovery; it was not replayed",
        code: "TASK_CONTROL_OUTCOME_UNKNOWN",
      });
      assert.deepEqual(await readdir(`${queueRoot}/processing`), []);
    } finally {
      await bridge.close();
    }
  });

  it("wakes an idle host bridge immediately when the request watcher fires", async () => {
    const root = await temporaryDirectory("task-v2-mcp-watch-wake-");
    temporaryDirectories.push(root);
    const queueRoot = `${root}/mcp/watch-wake`;
    let wake = null;
    const bridge = await createTaskControlMcpBridge({
      queueRoot,
      token: "watch-token",
      pollMinMs: 5,
      pollMaxMs: 200,
      watchRequests: (_directory, listener) => {
        wake = listener;
        return { on() { return this; }, unref() {}, close() {} };
      },
      invoke: async () => ({ ok: true }),
    });
    try {
      await waitUntil(() => bridge.pollingStats().idleDelay === 200);
      const beforeWake = bridge.pollingStats().pollCount;
      const request = { id: "watch-wake", token: "watch-token", tool: "list_agents", arguments: {} };
      await writeFile(`${queueRoot}/requests/${request.id}.json`, JSON.stringify(request), "utf8");
      wake?.();
      await waitUntil(async () => (await readJsonIfPresent(`${queueRoot}/responses/${request.id}.json`)) !== null);
      assert.equal(bridge.pollingStats().watchWakeups, 1);
      assert.ok(bridge.pollingStats().pollCount <= beforeWake + 2, "watch wake scheduled redundant host polls");
    } finally {
      await bridge.close();
    }
  });

  it("closes without trusting an in-flight host callback and fences its late response", async () => {
    const root = await temporaryDirectory("task-v2-mcp-close-drain-");
    temporaryDirectories.push(root);
    const queueRoot = `${root}/mcp/close-drain`;
    let releaseInvoke;
    let signalInvoke;
    let persisted = 0;
    let watcherClosed = false;
    const invokeEntered = new Promise((resolve) => { signalInvoke = resolve; });
    const invokeBlocked = new Promise((resolve) => { releaseInvoke = resolve; });
    const bridge = await createTaskControlMcpBridge({
      queueRoot,
      token: "close-token",
      pollMinMs: 5,
      pollMaxMs: 20,
      watchRequests: () => ({
        on() { return this; },
        unref() {},
        close() { watcherClosed = true; },
      }),
      invoke: async () => {
        signalInvoke();
        await invokeBlocked;
        return { tooLate: true };
      },
      persistResponse: async () => { persisted += 1; },
    });
    try {
      await writeFile(`${queueRoot}/requests/late.json`, JSON.stringify({
        id: "late", token: "close-token", tool: "list_agents", arguments: {},
      }), "utf8");
      await invokeEntered;

      await Promise.race([
        bridge.close(),
        delay(500).then(() => { throw new Error("MCP bridge close waited on an untrusted host callback"); }),
      ]);
      assert.equal(watcherClosed, true);
      assert.equal(bridge.pollingStats().watching, false);
      await assert.rejects(readdir(queueRoot), { code: "ENOENT" });

      releaseInvoke();
      await delay(25);
      assert.equal(persisted, 0);
      await assert.rejects(readdir(queueRoot), { code: "ENOENT" });
    } finally {
      releaseInvoke?.();
      await bridge.close();
    }
  });

  it("never starts a host mutation when close wins an in-flight request read", async () => {
    const root = await temporaryDirectory("task-v2-mcp-close-read-race-");
    temporaryDirectories.push(root);
    const queueRoot = `${root}/mcp/close-read-race`;
    let releaseRead;
    let signalRead;
    let invokeCount = 0;
    let persistCount = 0;
    const readEntered = new Promise((resolve) => { signalRead = resolve; });
    const readBlocked = new Promise((resolve) => { releaseRead = resolve; });
    const bridge = await createTaskControlMcpBridge({
      queueRoot,
      token: "close-read-token",
      pollMinMs: 5,
      pollMaxMs: 20,
      watchRequests: () => ({ on() { return this; }, unref() {}, close() {} }),
      readRequest: async (requestPath) => {
        const contents = await readFile(requestPath, "utf8");
        signalRead();
        await readBlocked;
        return contents;
      },
      invoke: async () => { invokeCount += 1; return { tooLate: true }; },
      persistResponse: async () => { persistCount += 1; },
    });
    try {
      await writeFile(`${queueRoot}/requests/late-read.json`, JSON.stringify({
        id: "late-read", token: "close-read-token", tool: "list_agents", arguments: {},
      }), "utf8");
      await readEntered;
      await bridge.close();
      releaseRead();
      await delay(25);
      assert.equal(invokeCount, 0);
      assert.equal(persistCount, 0);
      await assert.rejects(readdir(queueRoot), { code: "ENOENT" });
    } finally {
      releaseRead?.();
      await bridge.close();
    }
  });

  it("exposes structured delegation tools through MCP and routes calls to the durable host", async () => {
    const root = await temporaryDirectory("task-v2-mcp-user-");
    temporaryDirectories.push(root);
    const calls = [];
    const bridge = await createTaskControlMcpBridge({
      queueRoot: `${root}/mcp/task-safe-id`,
      token: "bridge-token",
      invoke: async (tool, args) => {
        calls.push({ tool, args });
        return tool === "list_agents" ? [{ id: "worker-1", depth: 1 }] : { ok: true };
      },
    });
    assert.deepEqual(bridge.mcpServers[0].env, []);
    const server = openMcpServer(bridge.mcpServers[0]);
    try {
      const initialized = await server.request("initialize");
      assert.equal(initialized.result.serverInfo.name, "onmyagent-task-control");
      server.notify("notifications/initialized");
      const listed = await server.request("tools/list");
      assert.deepEqual(listed.result.tools.map((tool) => tool.name), [
        "get_task_state",
        "list_agents",
        "spawn_agent",
        "send_message",
        "wait_agent",
        "close_agent",
        "checkpoint_task",
        "continue_task",
        "complete_task",
        "block_task",
        "realign_task",
      ]);
      const schemas = Object.fromEntries(listed.result.tools.map((tool) => [tool.name, tool.inputSchema]));
      assert.deepEqual(schemas.get_task_state.required, []);
      assert.deepEqual(schemas.list_agents.required, []);
      assert.equal(schemas.list_agents.additionalProperties, false);
      assert.deepEqual(schemas.spawn_agent.required, ["workerProfileId", "prompt"]);
      assert.deepEqual(schemas.send_message.required, ["attemptId", "text"]);
      assert.deepEqual(schemas.wait_agent.required, ["attemptId"]);
      assert.deepEqual(schemas.close_agent.required, ["attemptId"]);
      assert.deepEqual(schemas.complete_task.required, ["summary", "acceptanceResults"]);
      assert.deepEqual(schemas.continue_task.required, ["summary"]);
      assert.equal(schemas.spawn_agent.additionalProperties, false);
      const response = await server.request("tools/call", { name: "list_agents", arguments: { reason: "provider-test" } });
      assert.deepEqual(response.result.structuredContent, [{ id: "worker-1", depth: 1 }]);
      assert.deepEqual(calls, [{ tool: "list_agents", args: { reason: "provider-test" } }]);
    } finally {
      server.close();
      await bridge.close();
    }
  });

  it("adds the Node-mode environment contract when Electron launches the MCP bridge", async () => {
    const root = await temporaryDirectory("task-v2-mcp-electron-user-");
    temporaryDirectories.push(root);
    const bridge = await createTaskControlMcpBridge({
      queueRoot: `${root}/mcp/electron-safe-id`,
      token: "electron-token",
      electronRuntime: true,
      execPath: "/Applications/OnMyAgent.app/Contents/MacOS/OnMyAgent",
      invoke: async () => ({ ok: true }),
    });
    assert.deepEqual(bridge.mcpServers[0], {
      name: "onmyagent-task-control",
      command: "/Applications/OnMyAgent.app/Contents/MacOS/OnMyAgent",
      args: [
        bridge.mcpServers[0].args[0],
        `${root}/mcp/electron-safe-id`,
        "electron-token",
        "--timeout-ms=900000",
      ],
      env: [{ name: "ELECTRON_RUN_AS_NODE", value: "1" }],
    });
    await bridge.close();
  });

  it("surfaces a durable MCP response failure instead of leaving the provider waiting for its turn deadline", async () => {
    const root = await temporaryDirectory("task-v2-mcp-failure-user-");
    temporaryDirectories.push(root);
    let signalFatal;
    const fatal = new Promise((resolve) => { signalFatal = resolve; });
    const bridge = await createTaskControlMcpBridge({
      queueRoot: `${root}/mcp/failure-safe-id`,
      token: "failure-token",
      invoke: async () => ({ ok: true }),
      persistResponse: async () => { throw new Error("ENOSPC while persisting MCP response"); },
      onFatal: (error) => signalFatal(error),
    });
    const server = openMcpServer(bridge.mcpServers[0]);
    try {
      await server.request("initialize");
      const pending = server.request("tools/call", { name: "list_agents", arguments: {} }).catch(() => null);
      const error = await Promise.race([
        fatal,
        // The full runtime suite runs SQLite and multiple child-process tests
        // concurrently. Keep this harness watchdog comfortably above macOS
        // process-start contention while still bounding a genuinely swallowed
        // fatal response.
        new Promise((_, reject) => setTimeout(() => reject(new Error("MCP fatal error was swallowed")), 10_000)),
      ]);
      assert.match(error.message, /ENOSPC/);
      assert.match(bridge.getError()?.message ?? "", /ENOSPC/);
      server.close();
      await pending;
    } finally {
      server.close();
      await bridge.close();
    }
  });

  it("bounds a host call and returns a diagnostic MCP error when the Supervisor invocation hangs", async () => {
    const root = await temporaryDirectory("task-v2-mcp-timeout-user-");
    temporaryDirectories.push(root);
    const bridge = await createTaskControlMcpBridge({
      queueRoot: `${root}/mcp/timeout-safe-id`,
      token: "timeout-token",
      requestTimeoutMs: 1_000,
      invoke: async () => new Promise(() => {}),
    });
    const server = openMcpServer(bridge.mcpServers[0]);
    try {
      const response = await Promise.race([
        server.request("tools/call", { name: "list_agents", arguments: {} }),
        // The MCP fixture is a real child process. Under the full parallel
        // runtime suite its startup can be delayed even though the host call
        // itself remains bounded to the asserted 1 second below.
        new Promise((_, reject) => setTimeout(() => reject(new Error("MCP host timeout did not converge")), 7_000)),
      ]);
      assert.equal(response.error.code, -32000);
      assert.match(response.error.message, /timed out after 1000ms/i);
    } finally {
      server.close();
      await bridge.close();
    }
  });

  it("uses a separate structured proposal tool for alignment and rejects legacy state explicitly", async () => {
    const root = await temporaryDirectory("task-v2-mcp-alignment-");
    temporaryDirectories.push(root);
    let proposal = null;
    const bridge = await createTaskControlMcpBridge({
      queueRoot: `${root}/mcp/alignment-safe-id`,
      token: "alignment-token",
      alignment: true,
      invoke: async (tool, args) => {
        proposal = { tool, args };
        return { proposalId: "proposal-1", proposalRevision: 1, contract: args.contract };
      },
    });
    const server = openMcpServer(bridge.mcpServers[0]);
    try {
      const listed = await server.request("tools/list");
      assert.deepEqual(listed.result.tools.map((tool) => tool.name), ["propose_contract"]);
      assert.deepEqual(listed.result.tools[0].inputSchema.required, ["contract"]);
      assert.deepEqual(listed.result.tools[0].inputSchema.properties.contract.required, ["outcome", "deliverables", "acceptance", "scope", "verification"]);
      assert.deepEqual(listed.result.tools[0].inputSchema.properties.contract.properties.scope.required, ["included", "excluded"]);
      assert.equal(listed.result.tools[0].inputSchema.properties.contract.additionalProperties, false);
      const proposed = await server.request("tools/call", { name: "propose_contract", arguments: { contract: contract() } });
      assert.equal(proposed.result.structuredContent.proposalRevision, 1);
      assert.equal(proposal.tool, "propose_contract");
      assert.equal(proposal.args.contract.outcome, contract().outcome);
    } finally {
      server.close();
      await bridge.close();
    }

    const store = createTaskOrchestratorStore({ userDataDir: root });
    const legacyDirectory = `${store.legacyRootDirectory}/tasks/legacy-task`;
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(`${legacyDirectory}/task.json`, JSON.stringify({ schemaVersion: 1, title: "old" }), "utf8");
    await mkdir(`${legacyDirectory}/runs/legacy-run`, { recursive: true });
    await writeFile(`${legacyDirectory}/runs/legacy-run/run.json`, JSON.stringify({ schemaVersion: 1, id: "legacy-run" }), "utf8");
    await store.initialize();
    await assert.rejects(store.readTask("legacy-task"), /legacy Task Center v1 state and is read-only/);
    assert.match(await readFile(`${legacyDirectory}/task.json`, "utf8"), /schemaVersion/);

    const orchestrator = createTaskOrchestrator({ userDataDir: root, personalAgentRuntime: createRuntime(), pollMs: 1, awaitAlignment: true });
    try {
      assert.deepEqual(await orchestrator.listTasks({}), { tasks: [], issues: [], nextCursor: null, hasMore: false });
      await assert.rejects(orchestrator.getTask({ taskId: "legacy-task" }), /legacy Task Center v1 state and is read-only/);
    } finally {
      await orchestrator.close();
    }
  });
});
