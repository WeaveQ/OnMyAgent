import assert from "node:assert/strict";
import { spawn as nodeSpawnForTest } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { mkdtemp, rm, stat } from "node:fs/promises";

import {
  TASK_SUPERVISOR_MAX_FRAME_BYTES,
  createSafeRelaunchHandler,
  createSupervisorFrameDecoder,
  createTaskSupervisorClient,
  createTaskSupervisorServer,
  encodeSupervisorFrame,
  isSupervisorProcessAlive,
  probeSupervisorEndpoint,
  readSupervisorDescriptor,
  readSupervisorSecret,
  supervisorEndpointForUserData,
} from "./index.mjs";

const fixture = path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "fake-service.mjs");

async function tempRoot() {
  return mkdtemp(path.join(os.tmpdir(), "onmyagent-task-supervisor-test-"));
}

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for Supervisor test condition");
}

test("a stopped Supervisor rejects a late reconnect so shutdown cannot retain a second SQLite writer", async () => {
  const root = await tempRoot();
  const server = createTaskSupervisorServer({
    userDataDir: root,
    service: { pauseAllAndDrain: async () => ({ ok: true }) },
    secret: "d".repeat(64),
    supervisorEpoch: "epoch-late-reconnect",
  });
  await server.stop();
  let destroyed = false;
  server._onSocket({ destroy() { destroyed = true; } });
  assert.equal(destroyed, true);
  await rm(root, { recursive: true, force: true });
});

function rawConnection(endpoint) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });
}

function readFrames(socket) {
  return new Promise((resolve, reject) => {
    const frames = [];
    const decoder = createSupervisorFrameDecoder({
      onFrame(frame) { frames.push(frame); resolve(frames); },
      onError: reject,
    });
    socket.on("data", (chunk) => decoder.push(chunk));
    socket.once("error", reject);
  });
}

test("constructs a short Unix endpoint and a Windows named pipe", async () => {
  const longUserData = path.join(os.tmpdir(), "x".repeat(240), "user-data");
  const unix = supervisorEndpointForUserData(longUserData, { platform: "darwin", tempDir: "/tmp" });
  assert.ok(unix.length < 104, `Unix socket path too long: ${unix.length}`);
  assert.equal(supervisorEndpointForUserData(longUserData, { platform: "win32" }).startsWith("\\\\.\\pipe\\"), true);
});

test("rejects wrong token and stale epoch before dispatch", async () => {
  const root = await tempRoot();
  const service = { listTasks: async () => ({ tasks: [], issues: [] }) };
  const server = createTaskSupervisorServer({ userDataDir: root, service, secret: "a".repeat(64), supervisorEpoch: "epoch-current", startToken: "start-current" });
  const descriptor = await server.listen();
  const secret = await readSupervisorSecret(descriptor.secretPath);
  const wrongToken = await rawConnection(descriptor.endpoint);
  const tokenFrames = readFrames(wrongToken);
  wrongToken.write(encodeSupervisorFrame({ type: "hello", id: "bad-token", token: "b".repeat(64), supervisorEpoch: descriptor.supervisorEpoch, startToken: descriptor.startToken }));
  const tokenResponse = await tokenFrames;
  assert.equal(tokenResponse[0].ok, false);
  assert.equal(tokenResponse[0].error.code, "SUPERVISOR_AUTH_FAILED");
  wrongToken.destroy();
  const oldEpoch = await rawConnection(descriptor.endpoint);
  const epochFrames = readFrames(oldEpoch);
  oldEpoch.write(encodeSupervisorFrame({ type: "hello", id: "old-epoch", token: secret, supervisorEpoch: "epoch-old", startToken: descriptor.startToken }));
  const epochResponse = await epochFrames;
  assert.equal(epochResponse[0].error.code, "SUPERVISOR_EPOCH_MISMATCH");
  oldEpoch.destroy();
  await server.stop();
  await rm(root, { recursive: true, force: true });
});

test("deduplicates duplicate request ids and rejects oversized malformed frames", async () => {
  const root = await tempRoot();
  let calls = 0;
  const service = { listTasks: async () => ({ tasks: [{ id: String(++calls) }], issues: [] }) };
  const server = createTaskSupervisorServer({ userDataDir: root, service, secret: "c".repeat(64) });
  const descriptor = await server.listen();
  const secret = await readSupervisorSecret(descriptor.secretPath);
  const socket = await rawConnection(descriptor.endpoint);
  const helloFrames = readFrames(socket);
  socket.write(encodeSupervisorFrame({ type: "hello", id: "hello", token: secret, supervisorEpoch: descriptor.supervisorEpoch, startToken: descriptor.startToken }));
  const hello = await helloFrames;
  assert.equal(hello[0].ok, true);
  const request = encodeSupervisorFrame({ type: "request", id: "same-id", idempotencyKey: "same-id", method: "taskOrchestratorTasksList", params: {}, supervisorEpoch: descriptor.supervisorEpoch, startToken: descriptor.startToken });
  const firstFrames = readFrames(socket);
  socket.write(request);
  const first = await firstFrames;
  const secondFrames = readFrames(socket);
  socket.write(request);
  const second = await secondFrames;
  assert.equal(first[0].ok, true);
  assert.equal(second[0].ok, true);
  assert.equal(calls, 1);
  const malformed = await rawConnection(descriptor.endpoint);
  const malformedFrames = readFrames(malformed).catch((error) => ({ error }));
  malformed.write(`${"x".repeat(TASK_SUPERVISOR_MAX_FRAME_BYTES + 32)}\n`);
  const malformedFrame = await malformedFrames;
  assert.ok(malformedFrame.error || malformedFrame[0]?.error?.code === "SUPERVISOR_FRAME_TOO_LARGE");
  malformed.destroy();
  socket.destroy();
  await server.stop();
  await rm(root, { recursive: true, force: true });
});

test("reuses a durable request result after a Supervisor epoch changes instead of dispatching twice", async () => {
  const root = await tempRoot();
  const records = new Map();
  let calls = 0;
  const service = {
    listTasks: async () => ({ tasks: [{ id: `call-${++calls}` }], issues: [] }),
    async claimSupervisorRequest(input) {
      const record = records.get(input.idempotencyKey);
      if (!record) {
        records.set(input.idempotencyKey, { ...input, state: "processing" });
        return { state: "claimed" };
      }
      if (record.requestDigest !== input.requestDigest) throw new Error("digest mismatch");
      if (record.state === "completed") return { state: "completed", result: record.result };
      return record.ownerEpoch === input.ownerEpoch ? { state: "processing" } : { state: "unknown" };
    },
    async completeSupervisorRequest(input) {
      records.set(input.idempotencyKey, { ...records.get(input.idempotencyKey), state: "completed", result: input.result });
    },
    async failSupervisorRequest(input) {
      records.set(input.idempotencyKey, { ...records.get(input.idempotencyKey), state: "failed", error: input.error });
    },
  };
  async function invoke(server, id) {
    const descriptor = server.descriptor();
    const secret = await readSupervisorSecret(descriptor.secretPath);
    const socket = await rawConnection(descriptor.endpoint);
    const helloFrames = readFrames(socket);
    socket.write(encodeSupervisorFrame({ type: "hello", id: `hello-${id}`, token: secret, supervisorEpoch: descriptor.supervisorEpoch, startToken: descriptor.startToken }));
    assert.equal((await helloFrames)[0].ok, true);
    const responseFrames = readFrames(socket);
    socket.write(encodeSupervisorFrame({ type: "request", id, idempotencyKey: "durable-command-1", method: "taskOrchestratorTasksList", params: {}, supervisorEpoch: descriptor.supervisorEpoch, startToken: descriptor.startToken }));
    const response = (await responseFrames)[0];
    socket.destroy();
    return response;
  }
  const first = createTaskSupervisorServer({ userDataDir: root, service, secret: "f".repeat(64), supervisorEpoch: "epoch-first" });
  await first.listen();
  assert.equal((await invoke(first, "first-request")).result.tasks[0].id, "call-1");
  await first.stop();
  const second = createTaskSupervisorServer({ userDataDir: root, service, secret: "e".repeat(64), supervisorEpoch: "epoch-second" });
  await second.listen();
  assert.equal((await invoke(second, "retry-request")).result.tasks[0].id, "call-1");
  assert.equal(calls, 1);
  await second.stop();
  await rm(root, { recursive: true, force: true });
});

test("client reconnects after socket loss while the detached child continues", async () => {
  const root = await tempRoot();
  const client = createTaskSupervisorClient({ userDataDir: root, executable: process.execPath, serviceModule: fixture });
  const events = [];
  const unsubscribe = client.subscribe((event) => events.push(event));
  const first = await client.taskOrchestratorTasksList({});
  const firstDescriptor = await readSupervisorDescriptor(client._descriptorPath);
  assert.equal(first.tasks[0].id, "fake-task");
  assert.deepEqual(await client.getActiveWork(), {
    active: false,
    activeCount: 0,
    tasks: [],
    truncated: false,
  });
  assert.equal((await client.listRuns({ taskId: "fake-task" })).runs[0].id, "fake-run");
  assert.equal((await client.listEvents({ taskId: "fake-task", cursor: 7 })).nextCursor, 7);
  assert.equal((await client.listArtifacts({ taskId: "fake-task", taskRunId: "fake-run" })).artifacts[0].id, "fake-artifact");
  assert.equal((await client.getArtifact({ taskId: "fake-task", taskRunId: "fake-run", artifactId: "fake-artifact" })).content, "full fake artifact");
  assert.equal((await client.getArtifactContent({ taskId: "fake-task", taskRunId: "fake-run", artifactId: "fake-artifact" })).contentChunk, "fake chunk");
  assert.equal((await client.archiveTask({ taskId: "fake-task", expectedRevision: 1 })).task.definitionStatus, "archived");
  assert.equal((await client.restoreTask({ taskId: "fake-task", expectedRevision: 2 })).task.definitionStatus, "ready");
  assert.equal((await client.exportTaskManifest({ taskId: "fake-task" })).manifestSha256, "a".repeat(64));
  assert.deepEqual((await client.runMaintenance({})).protectedRows, { tasks: 1, runs: 1, artifacts: 1 });
  assert.equal((await client.getHealth({})).healthy, true);
  assert.ok(firstDescriptor?.pid);
  client.disconnect();
  const second = await client.taskOrchestratorTasksList({});
  const secondDescriptor = await readSupervisorDescriptor(client._descriptorPath);
  assert.equal(second.tasks[0].id, "fake-task");
  assert.equal(secondDescriptor?.pid, firstDescriptor?.pid);
  assert.equal(secondDescriptor?.supervisorEpoch, firstDescriptor?.supervisorEpoch);
  assert.ok(events.some((event) => event?.type === "task-supervisor-resync"));
  unsubscribe();
  await client.close("explicit_quit");
  await assert.rejects(stat(client._descriptorPath));
  await rm(root, { recursive: true, force: true });
});

test("lazy Supervisor spawn keeps the provider environment captured before the OpenCode sandbox mutates process.env", async () => {
  const root = await tempRoot();
  const key = "ONMYAGENT_TASK_SUPERVISOR_ENV_SNAPSHOT_TEST";
  const previous = process.env[key];
  process.env[key] = "real-provider-home";
  const client = createTaskSupervisorClient({
    userDataDir: root,
    executable: process.execPath,
    serviceModule: fixture,
  });
  // startOnMyAgentServer applies its managed OpenCode HOME/XDG environment
  // after the client is constructed but before the first Task Center command.
  process.env[key] = "opencode-sandbox-home";
  try {
    const result = await client.taskOrchestratorTasksList({});
    assert.equal(result.issues[0]?.environmentSnapshot, "real-provider-home");
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
    await client.close("explicit_quit").catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("client replaces a crashed detached Supervisor with a fresh authenticated epoch", async () => {
  const root = await tempRoot();
  const events = [];
  const client = createTaskSupervisorClient({
    userDataDir: root,
    executable: process.execPath,
    serviceModule: fixture,
    startupTimeoutMs: 5_000,
  });
  const unsubscribe = client.subscribe((event) => events.push(event));
  try {
    assert.equal((await client.taskOrchestratorTasksList({})).tasks[0].id, "fake-task");
    const first = await readSupervisorDescriptor(client._descriptorPath);
    assert.ok(first?.pid);
    process.kill(first.pid, "SIGKILL");
    await waitUntil(() => !isSupervisorProcessAlive(first.pid));
    const progressBeforeReplacement = events.filter((event) => event?.type === "fake-progress").length;
    assert.equal((await client.taskOrchestratorTasksList({})).tasks[0].id, "fake-task");
    const second = await readSupervisorDescriptor(client._descriptorPath);
    assert.ok(second?.pid);
    assert.notEqual(second.pid, first.pid);
    assert.notEqual(second.supervisorEpoch, first.supervisorEpoch);
    assert.notEqual(second.startToken, first.startToken);
    assert.equal(await probeSupervisorEndpoint(second, {
      secret: await readSupervisorSecret(second.secretPath),
    }), true);
    await waitUntil(() => events.filter((event) => event?.type === "fake-progress").length > progressBeforeReplacement);
    const snapshots = events.filter((event) => event?.type === "task-supervisor-resync");
    assert.equal(snapshots.at(-1)?.supervisorEpoch, second.supervisorEpoch);
  } finally {
    unsubscribe();
    await client.close("explicit_quit").catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("main-owned watchdog replaces a crashed Supervisor without an IPC request", async () => {
  const root = await tempRoot();
  const events = [];
  const client = createTaskSupervisorClient({
    userDataDir: root,
    executable: process.execPath,
    serviceModule: fixture,
    startupTimeoutMs: 5_000,
    watchdogIntervalMs: 50,
    watchdogMaxBackoffMs: 200,
  });
  const unsubscribe = client.subscribe((event) => events.push(event));
  try {
    await client.ensureConnected();
    const first = await readSupervisorDescriptor(client._descriptorPath);
    assert.ok(first?.pid);
    client.startWatchdog();
    process.kill(first.pid, "SIGKILL");
    await waitUntil(async () => {
      const current = await readSupervisorDescriptor(client._descriptorPath);
      return Boolean(current?.pid && current.pid !== first.pid && isSupervisorProcessAlive(current.pid));
    });
    const replacement = await readSupervisorDescriptor(client._descriptorPath);
    assert.notEqual(replacement.pid, first.pid);
    assert.notEqual(replacement.supervisorEpoch, first.supervisorEpoch);
    await waitUntil(() => events.some((event) =>
      event?.type === "task-supervisor-resync" &&
      event?.supervisorEpoch === replacement.supervisorEpoch));
    assert.equal(client.watchdogStatus().restarts, 1);
  } finally {
    unsubscribe();
    client.stopWatchdog();
    await client.close("explicit_quit").catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("watchdog restores a dropped event socket without waiting for an IPC request", async () => {
  const root = await tempRoot();
  const events = [];
  const client = createTaskSupervisorClient({
    userDataDir: root,
    executable: process.execPath,
    serviceModule: fixture,
    watchdogIntervalMs: 50,
  });
  const unsubscribe = client.subscribe((event) => events.push(event));
  try {
    await client.ensureConnected();
    const first = await readSupervisorDescriptor(client._descriptorPath);
    const resyncsBeforeDrop = events.filter((event) => event?.type === "task-supervisor-resync").length;
    client.startWatchdog();
    client.disconnect();
    await waitUntil(() =>
      events.filter((event) => event?.type === "task-supervisor-resync").length > resyncsBeforeDrop);
    const current = await readSupervisorDescriptor(client._descriptorPath);
    assert.equal(current.pid, first.pid);
    assert.equal(current.supervisorEpoch, first.supervisorEpoch);
    assert.equal(client.watchdogStatus().restarts, 0);
  } finally {
    unsubscribe();
    await client.close("explicit_quit").catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("watchdog keeps a live-but-unresponsive owner fenced instead of starting a second writer", async () => {
  const root = await tempRoot();
  let spawned = 0;
  let allowProbe = true;
  const client = createTaskSupervisorClient({
    userDataDir: root,
    executable: process.execPath,
    serviceModule: fixture,
    watchdogIntervalMs: 50,
    watchdogMaxBackoffMs: 100,
    random: () => 0.5,
    probeSupervisorEndpoint: async (descriptor, options) =>
      allowProbe ? probeSupervisorEndpoint(descriptor, options) : false,
    spawnProcess(file, args, options) {
      spawned += 1;
      return nodeSpawnForTest(file, args, options);
    },
  });
  try {
    await client.ensureConnected();
    const first = await readSupervisorDescriptor(client._descriptorPath);
    const originalDescriptor = { ...first };
    allowProbe = false;
    client.disconnect();
    client.startWatchdog();
    await waitUntil(() => client.watchdogStatus().lastError?.code === "SUPERVISOR_UNRESPONSIVE");
    assert.deepEqual(await readSupervisorDescriptor(client._descriptorPath), originalDescriptor);
    assert.equal(spawned, 1);
    client.stopWatchdog();
    allowProbe = true;
  } finally {
    await client.close("explicit_quit").catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit close fences the watchdog so a drained Supervisor is not restarted", async () => {
  const root = await tempRoot();
  const client = createTaskSupervisorClient({
    userDataDir: root,
    executable: process.execPath,
    serviceModule: fixture,
    watchdogIntervalMs: 50,
  });
  await client.ensureConnected();
  client.startWatchdog();
  await client.close("explicit_quit");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(await readSupervisorDescriptor(client._descriptorPath), null);
  assert.equal(client.watchdogStatus().enabled, false);
  await rm(root, { recursive: true, force: true });
});

test("explicit close waits for an in-flight watchdog before deciding the Supervisor is absent", async () => {
  const root = await tempRoot();
  let releaseProbe;
  let probeStartedResolve;
  const probeStarted = new Promise((resolve) => { probeStartedResolve = resolve; });
  const probeGate = new Promise((resolve) => { releaseProbe = resolve; });
  let gateWatchdogProbe = false;
  const client = createTaskSupervisorClient({
    userDataDir: root,
    executable: process.execPath,
    serviceModule: fixture,
    watchdogIntervalMs: 50,
    probeSupervisorEndpoint: async (descriptor, options) => {
      if (gateWatchdogProbe) {
        gateWatchdogProbe = false;
        probeStartedResolve();
        await probeGate;
      }
      return probeSupervisorEndpoint(descriptor, options);
    },
  });
  await client.ensureConnected();
  gateWatchdogProbe = true;
  client.startWatchdog();
  await probeStarted;
  const close = client.close("explicit_quit");
  let settled = false;
  void close.finally(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(settled, false);
  releaseProbe();
  await close;
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(await readSupervisorDescriptor(client._descriptorPath), null);
  assert.equal(client._child()?.exitCode === null && isSupervisorProcessAlive(client._child()?.pid), false);
  await rm(root, { recursive: true, force: true });
});

test("client retries an interrupted in-flight request with the same idempotency key", async () => {
  const root = await tempRoot();
  let calls = 0;
  let release;
  let startedResolve;
  const started = new Promise((resolve) => { startedResolve = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  const service = {
    async listTasks() {
      calls += 1;
      startedResolve();
      await gate;
      return { tasks: [{ id: "after-reconnect" }], issues: [] };
    },
    async pauseAllAndDrain() {},
  };
  const server = createTaskSupervisorServer({ userDataDir: root, service, secret: "9".repeat(64) });
  await server.listen();
  const client = createTaskSupervisorClient({ userDataDir: root, requestTimeoutMs: 2_000 });
  const request = client.taskOrchestratorTasksList({});
  await started;
  client.disconnect();
  release();
  const result = await request;
  assert.equal(result.tasks[0].id, "after-reconnect");
  assert.equal(calls, 1);
  await client.close("explicit_quit");
  await rm(root, { recursive: true, force: true });
});

test("main lifecycle mutation block rejects new task starts but keeps active-work reads available", async () => {
  const root = await tempRoot();
  const client = createTaskSupervisorClient({
    userDataDir: root,
    executable: process.execPath,
    serviceModule: fixture,
  });
  try {
    await client.ensureConnected();
    const release = client.blockMutations("engine_restart");
    assert.deepEqual(await client.getActiveWork(), {
      active: false,
      activeCount: 0,
      tasks: [],
      truncated: false,
    });
    await assert.rejects(
      client.startTask({ taskId: "fake-task" }),
      (error) => error?.code === "TASK_CENTER_MUTATIONS_BLOCKED" && error?.reason === "engine_restart",
    );
    release();
  } finally {
    await client.close("explicit_quit").catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("lifecycle coordinator can drain an already accepted mutation before inspecting active work", async () => {
  const root = await tempRoot();
  let releaseRequest;
  let requestStartedResolve;
  const requestStarted = new Promise((resolve) => { requestStartedResolve = resolve; });
  const requestGate = new Promise((resolve) => { releaseRequest = resolve; });
  const service = {
    async startTask() {
      requestStartedResolve();
      await requestGate;
      return { ok: true };
    },
    async activeWorkStatus() {
      return { active: false, activeCount: 0, tasks: [], truncated: false };
    },
    async pauseAllAndDrain() {},
  };
  const server = createTaskSupervisorServer({ userDataDir: root, service, secret: "4".repeat(64) });
  await server.listen();
  const client = createTaskSupervisorClient({ userDataDir: root, requestTimeoutMs: 2_000 });
  try {
    const accepted = client.startTask({ taskId: "fake-task" });
    await requestStarted;
    const releaseBlock = client.blockMutations("engine_restart");
    let idle = false;
    const drain = client.awaitMutationsIdle().then(() => { idle = true; });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(idle, false);
    releaseRequest();
    await accepted;
    await drain;
    releaseBlock();
  } finally {
    await client.close("explicit_quit").catch(() => undefined);
    await server.stop();
    await rm(root, { recursive: true, force: true });
  }
});

test("watchdog backoff uses bounded injectable jitter and exposes circuit state", async () => {
  const root = await tempRoot();
  let spawnAttempts = 0;
  const client = createTaskSupervisorClient({
    userDataDir: root,
    executable: process.execPath,
    serviceModule: path.join(root, "missing-service-module.mjs"),
    startupTimeoutMs: 250,
    watchdogIntervalMs: 100,
    watchdogMaxBackoffMs: 1_000,
    watchdogMaxRestarts: 2,
    random: () => 1,
    spawnProcess(file, args, options) {
      spawnAttempts += 1;
      return nodeSpawnForTest(file, args, options);
    },
  });
  try {
    client.startWatchdog();
    await waitUntil(() => client.watchdogStatus().lastError?.code === "SUPERVISOR_START_TIMEOUT");
    const afterFirstFailure = client.watchdogStatus();
    assert.equal(afterFirstFailure.nextDelayMs, 120);
    assert.equal(afterFirstFailure.circuitOpen, false);
    assert.equal(afterFirstFailure.restartWindowCount, 1);

    await waitUntil(() => client.watchdogStatus().lastError?.code === "SUPERVISOR_WATCHDOG_CIRCUIT_OPEN");
    const circuit = client.watchdogStatus();
    assert.equal(circuit.circuitOpen, true);
    assert.equal(circuit.maxRestartsPerWindow, 2);
    assert.equal(circuit.restartWindowCount, 2);
    assert.ok(circuit.nextDelayMs >= 100 && circuit.nextDelayMs <= 1_000);
    assert.equal(spawnAttempts, 2);
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.equal(spawnAttempts, 2, "an open circuit must not spawn another child");
  } finally {
    client.stopWatchdog();
    await client.close("test-close").catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("explicit safe shutdown propagates drain failures and relaunch waits for the drain", async () => {
  const order = [];
  const relaunch = createSafeRelaunchHandler({
    pauseAllAndDrain: async (reason) => { order.push(`pause:${reason}`); },
    relaunch: async () => { order.push("relaunch"); },
    exit: async (code) => { order.push(`exit:${code}`); },
  });
  await relaunch();
  assert.deepEqual(order, ["pause:explicit_relaunch", "relaunch", "exit:0"]);
  const root = await tempRoot();
  const server = createTaskSupervisorServer({ userDataDir: path.join(root, "direct"), service: { pauseAllAndDrain: async () => { throw Object.assign(new Error("drain failed"), { code: "DRAIN_FAILED" }); } } });
  await server.listen();
  await assert.rejects(server.pauseAllAndDrain("explicit_quit"), /drain failed/);
  await server.stop();
  await rm(root, { recursive: true, force: true });
});

test("a failed safe drain remains retryable instead of caching the first rejection", async () => {
  const root = await tempRoot();
  let drains = 0;
  const server = createTaskSupervisorServer({
    userDataDir: root,
    service: {
      async pauseAllAndDrain() {
        drains += 1;
        if (drains === 1) throw Object.assign(new Error("temporary drain failure"), { code: "TEMPORARY_DRAIN_FAILURE" });
      },
    },
  });
  await server.listen();
  await assert.rejects(server.pauseAllAndDrain("explicit_quit"), /temporary drain failure/);
  assert.deepEqual(await server.pauseAllAndDrain("explicit_quit"), { ok: true, reason: "explicit_quit" });
  assert.equal(drains, 2);
  await server.stop();
  await rm(root, { recursive: true, force: true });
});

test("descriptor secret is private and endpoint probe fences stale identity", async () => {
  const root = await tempRoot();
  const server = createTaskSupervisorServer({ userDataDir: root, service: {}, secret: "d".repeat(64), supervisorEpoch: "epoch", startToken: "start" });
  const descriptor = await server.listen();
  const descriptorStat = await stat(server.descriptorPath);
  const secretStat = await stat(server.secretPath);
  assert.equal(descriptorStat.mode & 0o777, 0o600);
  assert.equal(secretStat.mode & 0o777, 0o600);
  assert.equal(await probeSupervisorEndpoint(descriptor, { secret: "e".repeat(64) }), false);
  assert.equal(await probeSupervisorEndpoint(descriptor, { secret: "d".repeat(64) }), true);
  await server.stop();
  await rm(root, { recursive: true, force: true });
});
