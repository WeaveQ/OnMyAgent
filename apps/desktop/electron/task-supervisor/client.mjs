import { spawn as nodeSpawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createTaskSupervisorStructuredLog } from "./structured-log.mjs";

import {
  TASK_SUPERVISOR_PROTOCOL_VERSION,
  createSupervisorFrameDecoder,
  encodeSupervisorFrame,
  isValidSupervisorSecret,
  randomSupervisorStartToken,
  supervisorDescriptorPaths,
} from "./protocol.mjs";
import {
  cleanupSupervisorDescriptor,
  isSupervisorProcessAlive,
  probeSupervisorEndpoint,
  readSupervisorDescriptor,
  readSupervisorSecret,
} from "./server.mjs";

const DEFAULT_CONNECT_TIMEOUT_MS = 8_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_WATCHDOG_INTERVAL_MS = 5_000;
const DEFAULT_WATCHDOG_MAX_BACKOFF_MS = 30_000;
const DEFAULT_WATCHDOG_RESTART_WINDOW_MS = 5 * 60_000;
const DEFAULT_WATCHDOG_MAX_RESTARTS = 5;
const SUPERVISOR_ENTRYPOINT = fileURLToPath(new URL("./process.mjs", import.meta.url));
const READ_ONLY_SUPERVISOR_METHODS = new Set([
  "supervisor.snapshot",
  "supervisor.activeWork",
  "supervisor.health",
  "supervisor.powerEvent",
  "taskOrchestratorTasksList",
  "taskOrchestratorTaskGet",
  "taskOrchestratorRunsList",
  "taskOrchestratorTurnHistoryList",
  "taskOrchestratorEventsList",
  "taskOrchestratorArtifactsList",
  "taskOrchestratorArtifactGet",
  "taskOrchestratorArtifactContentGet",
  "taskOrchestratorTaskExportManifest",
  "taskOrchestratorHealthGet",
  "taskOrchestratorOperationsDiagnosticsGet",
]);

function errorFromRemote(value, fallbackCode = "SUPERVISOR_REQUEST_FAILED") {
  return Object.assign(
    new Error(String(value?.message ?? value ?? "Task Supervisor request failed")),
    { code: String(value?.code ?? fallbackCode) },
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function newRequestId() {
  return `desktop-${process.pid}-${Date.now().toString(36)}-${randomSupervisorStartToken()}`;
}

/** @param {{pauseAllAndDrain?: (reason: string) => Promise<unknown>, relaunch?: () => unknown, exit?: (code: number) => unknown}} options */
export function createSafeRelaunchHandler({ pauseAllAndDrain, relaunch, exit } = {}) {
  if (typeof pauseAllAndDrain !== "function") throw new Error("pauseAllAndDrain is required");
  if (typeof relaunch !== "function") throw new Error("relaunch is required");
  return async (reason = "explicit_relaunch") => {
    await pauseAllAndDrain(reason);
    await relaunch();
    if (typeof exit === "function") await exit(0);
    return { ok: true };
  };
}

/**
 * Lazy Electron-side proxy.  No child process is spawned until a Task Center
 * command is invoked.  Dropping the socket never asks the child to stop, so a
 * renderer reload/window close can reconnect to the same Supervisor epoch.
 */
export function createTaskSupervisorClient(options = {}) {
  const configuredUserDataDir = String(options.userDataDir ?? "").trim();
  if (!configuredUserDataDir) throw new Error("Task Supervisor userDataDir is required");
  const userDataDir = path.resolve(configuredUserDataDir);
  const paths = supervisorDescriptorPaths(userDataDir);
  const structuredLog = options.structuredLog ?? createTaskSupervisorStructuredLog({ userDataDir });
  const descriptorPath = options.descriptorPath ?? paths.descriptorPath;
  const entrypoint = options.entrypoint ?? SUPERVISOR_ENTRYPOINT;
  const serviceModule = options.serviceModule ?? null;
  const executable = options.executable ?? process.execPath;
  // Capture the provider environment while Electron main is being composed.
  // The embedded OpenCode server later installs its managed HOME/XDG sandbox
  // into process.env. A lazy Supervisor spawn must not inherit that unrelated
  // sandbox or Codex/Claude lose their real user config and model aliases.
  const inheritedEnv = { ...process.env };
  const extraEnv = options.env && typeof options.env === "object" ? { ...options.env } : {};
  const spawnProcess = options.spawnProcess ?? ((file, args, spawnOptions) => nodeSpawn(file, args, spawnOptions));
  const netConnect = options.netConnect ?? ((endpoint) => net.createConnection(endpoint));
  const probeEndpoint = options.probeSupervisorEndpoint ?? probeSupervisorEndpoint;
  const random = typeof options.random === "function" ? options.random : Math.random;
  const startupTimeoutMs = Math.max(250, Number(options.startupTimeoutMs) || DEFAULT_CONNECT_TIMEOUT_MS);
  const requestTimeoutMs = Math.max(100, Number(options.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS);
  const watchdogIntervalMs = Math.max(50, Number(options.watchdogIntervalMs) || DEFAULT_WATCHDOG_INTERVAL_MS);
  const watchdogMaxBackoffMs = Math.max(watchdogIntervalMs, Number(options.watchdogMaxBackoffMs) || DEFAULT_WATCHDOG_MAX_BACKOFF_MS);
  const watchdogRestartWindowMs = Math.max(watchdogIntervalMs, Number(options.watchdogRestartWindowMs) || DEFAULT_WATCHDOG_RESTART_WINDOW_MS);
  const watchdogMaxRestarts = Math.max(1, Number(options.watchdogMaxRestarts) || DEFAULT_WATCHDOG_MAX_RESTARTS);
  const eventListeners = new Set();
  const inflight = new Map();
  let socket = null;
  let connected = false;
  let connecting = null;
  let child = null;
  let descriptor = null;
  let closed = false;
  let closing = false;
  let closePromise = null;
  let sequence = 0;
  let syncing = null;
  const queuedEvents = [];
  let requestCounter = 0;
  let watchdogEnabled = false;
  let watchdogTimer = null;
  let watchdogInFlight = null;
  let watchdogFailures = 0;
  let watchdogRestarts = 0;
  let watchdogLastError = null;
  let watchdogGeneration = 0;
  const watchdogRestartHistory = [];
  const mutationBlocks = new Map();
  const mutationRequests = new Set();

  function supervisorIdentity(value) {
    if (!value) return null;
    return `${value.pid}:${value.supervisorEpoch}:${value.startToken}`;
  }

  function emit(event) {
    for (const listener of [...eventListeners]) {
      try { Promise.resolve(listener(event)).catch(() => undefined); } catch { /* listener failures are isolated */ }
    }
  }

  function rejectInflight(error) {
    for (const [id, pending] of inflight) {
      clearTimeout(pending.timer);
      pending.reject(error);
      inflight.delete(id);
    }
  }

  function markDisconnected(error = new Error("Task Supervisor connection closed")) {
    connected = false;
    if (socket) {
      const stale = socket;
      socket = null;
      try { stale.destroy(); } catch { /* best effort */ }
    }
    rejectInflight(error);
  }

  function clearWatchdogTimer() {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }

  function watchdogDelay() {
    if (watchdogFailures <= 0) return watchdogIntervalMs;
    const base = Math.min(watchdogMaxBackoffMs, watchdogIntervalMs * (2 ** Math.min(8, watchdogFailures - 1)));
    // Symmetric bounded jitter avoids multiple desktop instances or restored
    // machines probing/restarting on the same cadence after an outage.
    const jitterRatio = Math.min(1, Math.max(0, Number(random()) || 0));
    return Math.min(
      watchdogMaxBackoffMs,
      Math.max(watchdogIntervalMs, Math.round(base * (0.8 + (jitterRatio * 0.4)))),
    );
  }

  function pruneWatchdogRestartHistory(observedAt = Date.now()) {
    const restartCutoff = observedAt - watchdogRestartWindowMs;
    while (watchdogRestartHistory[0] < restartCutoff) watchdogRestartHistory.shift();
    return watchdogRestartHistory.length;
  }

  function watchdogActive(generation) {
    return watchdogEnabled && !closed && !closing && generation === watchdogGeneration;
  }

  function scheduleWatchdog(delayMs = watchdogDelay(), generation = watchdogGeneration) {
    if (!watchdogActive(generation)) return;
    clearWatchdogTimer();
    watchdogTimer = setTimeout(() => {
      watchdogTimer = null;
      void runWatchdog(generation);
    }, Math.max(0, Number(delayMs) || 0));
    watchdogTimer.unref?.();
  }

  async function runWatchdog(generation = watchdogGeneration) {
    if (!watchdogActive(generation)) return null;
    if (watchdogInFlight) return watchdogInFlight;
    watchdogInFlight = (async () => {
      const current = await readCurrentDescriptor();
      if (!watchdogActive(generation)) return { ok: false, stale: true };
      const processAlive = current ? isSupervisorProcessAlive(current.descriptor.pid) : false;
      const endpointHealthy = current && processAlive
        ? await probeEndpoint(current.descriptor, {
            secret: current.secret,
            timeoutMs: Math.min(500, watchdogIntervalMs),
          })
        : false;
      if (!watchdogActive(generation)) return { ok: false, stale: true };
      if (endpointHealthy) {
        const currentIdentity = supervisorIdentity(current.descriptor);
        const connectedIdentity = supervisorIdentity(descriptor);
        if (!connected || !socket || socket.destroyed || currentIdentity !== connectedIdentity) {
          markDisconnected(Object.assign(
            new Error("Task Supervisor watchdog is restoring its event connection"),
            { code: "SUPERVISOR_WATCHDOG_RECONNECT" },
          ));
          await connect();
          if (!watchdogActive(generation)) return { ok: false, stale: true };
          watchdogFailures = 0;
          watchdogLastError = null;
          return { ok: true, reconnected: true, pid: current.descriptor.pid };
        }
        watchdogFailures = 0;
        watchdogLastError = null;
        return { ok: true, pid: current.descriptor.pid };
      }
      const previousIdentity = supervisorIdentity(current?.descriptor);
      const error = Object.assign(
        new Error(processAlive
          ? "Task Supervisor process is alive but its endpoint is unresponsive"
          : "Task Supervisor process is absent"),
        { code: processAlive ? "SUPERVISOR_UNRESPONSIVE" : "SUPERVISOR_UNAVAILABLE" },
      );
      watchdogFailures += 1;
      watchdogLastError = { code: error.code, message: error.message, at: Date.now() };
      markDisconnected(error);
      // Never remove a descriptor owned by a live but unresponsive process:
      // doing so could spawn a second SQLite writer. Dead/absent owners are
      // safely replaced by connect(), which performs the authenticated fence.
      if (processAlive) throw error;
      pruneWatchdogRestartHistory();
      if (watchdogRestartHistory.length >= watchdogMaxRestarts) {
        throw Object.assign(
          new Error("Task Supervisor watchdog restart circuit is open"),
          { code: "SUPERVISOR_WATCHDOG_CIRCUIT_OPEN" },
        );
      }
      // Count attempts, not only successful replacements. A child that exits
      // before publishing its descriptor must still consume the bounded
      // restart budget or a broken binary could be spawned forever.
      watchdogRestartHistory.push(Date.now());
      if (!watchdogActive(generation)) return { ok: false, stale: true };
      await connect();
      if (!watchdogActive(generation)) return { ok: false, stale: true };
      const next = descriptor;
      const nextIdentity = supervisorIdentity(next);
      if (nextIdentity && nextIdentity !== previousIdentity) {
        watchdogRestarts += 1;
      }
      watchdogFailures = 0;
      watchdogLastError = null;
      return { ok: true, restarted: true, pid: next?.pid ?? null };
    })().catch((error) => {
      watchdogLastError = {
        code: String(error?.code ?? "SUPERVISOR_WATCHDOG_FAILED"),
        message: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      };
      return { ok: false, error: watchdogLastError };
    }).finally(() => {
      watchdogInFlight = null;
      scheduleWatchdog(watchdogDelay(), generation);
    });
    return watchdogInFlight;
  }

  function send(frame) {
    if (!socket || !connected || socket.destroyed) {
      throw Object.assign(new Error("Task Supervisor is disconnected"), { code: "SUPERVISOR_DISCONNECTED" });
    }
    socket.write(encodeSupervisorFrame({
      supervisorEpoch: descriptor.supervisorEpoch,
      startToken: descriptor.startToken,
      ...frame,
    }));
  }

  async function readCurrentDescriptor() {
    const next = await readSupervisorDescriptor(descriptorPath);
    if (!next) return null;
    const secret = await readSupervisorSecret(next.secretPath);
    if (!isValidSupervisorSecret(secret)) return null;
    return { descriptor: next, secret };
  }

  function spawnSupervisor() {
    if (child && child.exitCode === null) return child;
    const env = {
      ...inheritedEnv,
      ...extraEnv,
      ELECTRON_RUN_AS_NODE: "1",
      ONMYAGENT_TASK_SUPERVISOR_USER_DATA: userDataDir,
      ONMYAGENT_TASK_SUPERVISOR_DESCRIPTOR: descriptorPath,
    };
    const args = [entrypoint, "--user-data", userDataDir, "--descriptor", descriptorPath];
    if (serviceModule) args.push("--service-module", serviceModule);
    const spawnedChild = spawnProcess(executable, args, {
      detached: true,
      stdio: "ignore",
      env,
      windowsHide: true,
    });
    child = spawnedChild;
    child?.unref?.();
    child?.once?.("error", (error) => {
      void structuredLog.recordCrash(error, { source: "child-error" }).catch(() => undefined);
      if (!connected) markDisconnected(errorFromRemote(error, "SUPERVISOR_START_FAILED"));
    });
    child?.once?.("exit", (code, signal) => {
      if (child === spawnedChild) child = null;
      if (!closed && !closing && (code !== 0 || signal)) {
        void structuredLog.recordCrash(Object.assign(new Error("Task Supervisor child exited unexpectedly"), { code: "SUPERVISOR_CHILD_EXIT" }), {
          source: "child-exit",
          exitCode: code,
          signal,
        }).catch(() => undefined);
      }
    });
    return child;
  }

  async function waitForDescriptor() {
    const deadline = Date.now() + startupTimeoutMs;
    let spawned = false;
    while (Date.now() < deadline) {
      const current = await readCurrentDescriptor();
      if (current) {
        const processAlive = isSupervisorProcessAlive(current.descriptor.pid);
        const endpointHealthy = processAlive && await probeEndpoint(current.descriptor, {
          secret: current.secret,
          timeoutMs: Math.min(250, startupTimeoutMs),
        });
        if (endpointHealthy) return current;
        // A dead descriptor can be removed before replacement. A live but
        // unresponsive process may still own SQLite, so PID liveness alone is
        // not authority to fence its descriptor or start a second writer.
        if (!processAlive) {
          if (child?.pid === current.descriptor.pid) child = null;
          await cleanupSupervisorDescriptor({
            descriptorPath,
            secretPath: current.descriptor.secretPath,
            endpoint: current.descriptor.endpoint,
          });
        } else {
          // A live process may still own SQLite even when its endpoint is
          // temporarily unresponsive. Never fence it merely on a timeout.
          await sleep(25);
          continue;
        }
      }
      if (!spawned) {
        spawnSupervisor();
        spawned = true;
      }
      await sleep(25);
    }
    throw Object.assign(new Error("Task Supervisor did not publish a descriptor in time"), { code: "SUPERVISOR_START_TIMEOUT" });
  }

  async function connectToCurrent(current) {
    const nextDescriptor = current.descriptor;
    const nextSecret = current.secret;
    return new Promise((resolve, reject) => {
      let settled = false;
      let handshakeTimer;
      let candidate;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(handshakeTimer);
        if (error) {
          try { candidate?.destroy(); } catch { /* best effort */ }
          reject(error);
        } else resolve();
      };
      let decoder;
      const onFrame = (frame) => {
        if (frame.type !== "hello") return;
        if (frame.ok !== true) {
          finish(errorFromRemote(frame.error, "SUPERVISOR_AUTH_FAILED"));
          return;
        }
        if (frame.supervisorEpoch !== nextDescriptor.supervisorEpoch || frame.startToken !== nextDescriptor.startToken) {
          finish(Object.assign(new Error("Task Supervisor epoch or start token changed during handshake"), { code: "SUPERVISOR_EPOCH_MISMATCH" }));
          return;
        }
        const priorIdentity = descriptor
          ? `${descriptor.supervisorEpoch}:${descriptor.startToken}`
          : null;
        const nextIdentity = `${nextDescriptor.supervisorEpoch}:${nextDescriptor.startToken}`;
        if (priorIdentity && priorIdentity !== nextIdentity) {
          // Event sequence numbers are scoped to one Supervisor epoch.  A
          // replacement starts at sequence zero; retaining the old watermark
          // would silently discard every event until the new process caught
          // up with the previous counter.
          sequence = 0;
          queuedEvents.splice(0, queuedEvents.length);
        }
        descriptor = nextDescriptor;
        socket = candidate;
        connected = true;
        finish();
      };
      decoder = createSupervisorFrameDecoder({
        onFrame: (frame) => {
          if (settled) handleFrame(frame);
          else onFrame(frame);
        },
        onError: (error) => finish(error),
      });
      handshakeTimer = setTimeout(() => finish(Object.assign(new Error("Task Supervisor handshake timed out"), { code: "SUPERVISOR_HANDSHAKE_TIMEOUT" })), startupTimeoutMs);
      handshakeTimer.unref?.();
      try {
        candidate = netConnect(nextDescriptor.endpoint);
        candidate.setNoDelay?.(true);
        candidate.on("data", (chunk) => {
          decoder.push(chunk);
        });
        candidate.once("error", (error) => finish(errorFromRemote(error, "SUPERVISOR_CONNECT_FAILED")));
        candidate.once("close", () => {
          if (!settled) finish(Object.assign(new Error("Task Supervisor closed during handshake"), { code: "SUPERVISOR_CONNECT_FAILED" }));
          else if (socket === candidate) markDisconnected(Object.assign(new Error("Task Supervisor connection closed"), { code: "SUPERVISOR_DISCONNECTED" }));
        });
        candidate.once("connect", () => {
          try {
            candidate.write(encodeSupervisorFrame({
              type: "hello",
              id: newRequestId(),
              token: nextSecret,
              supervisorEpoch: nextDescriptor.supervisorEpoch,
              startToken: nextDescriptor.startToken,
            }));
          } catch (error) { finish(error); }
        });
      } catch (error) {
        finish(errorFromRemote(error, "SUPERVISOR_CONNECT_FAILED"));
      }
    });
  }

  function handleFrame(frameOrChunk) {
    if (!frameOrChunk) return;
    if (typeof frameOrChunk !== "object" || Buffer.isBuffer(frameOrChunk)) return;
    const frame = frameOrChunk;
    if (frame.type === "response") {
      const pending = inflight.get(String(frame.id));
      if (!pending) return;
      inflight.delete(String(frame.id));
      clearTimeout(pending.timer);
      if (frame.ok === true) pending.resolve(frame.result);
      else pending.reject(errorFromRemote(frame.error));
      return;
    }
    if (frame.type === "event") {
      const nextSequence = Number(frame.sequence);
      if (Number.isInteger(nextSequence) && nextSequence <= sequence) return;
      if (syncing) {
        queuedEvents.push(frame);
        return;
      }
      if (Number.isInteger(nextSequence) && nextSequence > sequence + 1) {
        queuedEvents.push(frame);
        void syncSnapshot().catch(() => undefined);
        return;
      }
      if (Number.isInteger(nextSequence)) sequence = nextSequence;
      emit(frame.event);
    }
  }

  async function syncSnapshot() {
    if (syncing) return syncing;
    if (!connected) return null;
    syncing = (async () => {
      const result = await request("supervisor.snapshot", {}, { skipConnect: true, retryOnDisconnect: false });
      const snapshotSequence = Number(result?.sequence);
      if (Number.isInteger(snapshotSequence)) sequence = Math.max(sequence, snapshotSequence);
      const event = {
        type: "task-supervisor-resync",
        sequence: Number.isInteger(snapshotSequence) ? snapshotSequence : sequence,
        supervisorEpoch: descriptor.supervisorEpoch,
        coveredScopes: ["task-list"],
        snapshot: result?.snapshot ?? result,
      };
      emit(event);
      // Snapshot is always delivered before any events buffered while the
      // request was in flight.  Events already covered by the snapshot are
      // intentionally dropped; the snapshot is their authoritative state.
      const pending = queuedEvents.splice(0, queuedEvents.length)
        .sort((left, right) => Number(left.sequence) - Number(right.sequence));
      for (const pendingFrame of pending) {
        const pendingSequence = Number(pendingFrame.sequence);
        if (!Number.isInteger(pendingSequence) || pendingSequence <= sequence) continue;
        sequence = pendingSequence;
        emit(pendingFrame.event);
      }
      return event;
    })().finally(() => { syncing = null; });
    return syncing;
  }

  async function connect(connectOptions = {}) {
    if (closed || (closing && connectOptions.allowClosing !== true)) {
      throw Object.assign(new Error("Task Supervisor client is closing or closed"), { code: "SUPERVISOR_CLIENT_CLOSED" });
    }
    if (connected && socket && !socket.destroyed) return;
    if (connecting) return connecting;
    connecting = (async () => {
      const current = await waitForDescriptor();
      await connectToCurrent(current);
      if (eventListeners.size > 0) await syncSnapshot();
    })().finally(() => { connecting = null; });
    return connecting;
  }

  async function requestOnce(method, params, requestOptions, idempotencyKey) {
    if (!requestOptions.skipConnect) await connect({ allowClosing: requestOptions.allowClosing === true });
    const id = `${newRequestId()}-${++requestCounter}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        inflight.delete(id);
        reject(Object.assign(new Error(`Task Supervisor request timed out: ${method}`), { code: "SUPERVISOR_REQUEST_TIMEOUT" }));
      }, Math.max(100, Number(requestOptions.timeoutMs) || requestTimeoutMs));
      timer.unref?.();
      inflight.set(id, { resolve, reject, timer });
      try {
        send({ type: "request", id, idempotencyKey, method, params });
      } catch (error) {
        clearTimeout(timer);
        inflight.delete(id);
        reject(error);
      }
    });
  }

  async function request(method, params = {}, requestOptions = {}) {
    const mutating = !READ_ONLY_SUPERVISOR_METHODS.has(method) && !method.startsWith("supervisor.");
    if (mutating) {
      const block = mutationBlocks.values().next().value;
      if (block) {
        throw Object.assign(
          new Error(`Task Center mutations are temporarily blocked: ${block.reason}`),
          { code: "TASK_CENTER_MUTATIONS_BLOCKED", reason: block.reason },
        );
      }
    }
    const operation = (async () => {
      const idempotencyKey = String(requestOptions.idempotencyKey ?? `${newRequestId()}-${++requestCounter}`);
      const attempts = requestOptions.retryOnDisconnect === false ? 1 : 2;
      let lastError = null;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
          return await requestOnce(method, params, requestOptions, idempotencyKey);
        } catch (error) {
          lastError = error;
          const code = String(error?.code ?? "");
          const retryable = [
            "SUPERVISOR_DISCONNECTED",
            "SUPERVISOR_CONNECT_FAILED",
            "SUPERVISOR_REQUEST_TIMEOUT",
          ].includes(code);
          if (!retryable || attempt + 1 >= attempts) throw error;
          markDisconnected(error);
          await connect();
        }
      }
      throw lastError ?? new Error(`Task Supervisor request failed: ${method}`);
    })();
    if (!mutating) return operation;
    mutationRequests.add(operation);
    try {
      return await operation;
    } finally {
      mutationRequests.delete(operation);
    }
  }

  function subscribe(listener) {
    if (typeof listener !== "function") throw new Error("Task Supervisor listener must be a function");
    if (closed) throw new Error("Task Supervisor client is closed");
    eventListeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      eventListeners.delete(listener);
    };
  }

  async function close(reason = "explicit_quit") {
    if (closePromise) return closePromise;
    const resumeWatchdogOnFailure = watchdogEnabled;
    closing = true;
    watchdogEnabled = false;
    watchdogGeneration += 1;
    clearWatchdogTimer();
    closePromise = (async () => {
      await watchdogInFlight;
      await connecting?.catch(() => undefined);
      const current = await readCurrentDescriptor();
      if (!current) {
        closed = true;
        closing = false;
        markDisconnected();
        return { ok: true, reason, absent: true };
      }
      // Explicit quit must not silently continue when draining fails.  The
      // rejection is intentionally propagated to before-quit/relaunch callers.
      const result = await request("supervisor.shutdown", { reason }, {
        timeoutMs: requestTimeoutMs * 2,
        retryOnDisconnect: false,
        allowClosing: true,
      });
      const deadline = Date.now() + startupTimeoutMs;
      while (Date.now() < deadline) {
        if (!(await readSupervisorDescriptor(descriptorPath))) break;
        await sleep(25);
      }
      if (await readSupervisorDescriptor(descriptorPath)) {
        throw Object.assign(new Error("Task Supervisor did not finish safe shutdown"), { code: "SUPERVISOR_SHUTDOWN_TIMEOUT" });
      }
      closed = true;
      closing = false;
      markDisconnected();
      eventListeners.clear();
      return result;
    })().catch((error) => {
      closePromise = null;
      closing = false;
      if (resumeWatchdogOnFailure && !closed) {
        watchdogEnabled = true;
        watchdogGeneration += 1;
        scheduleWatchdog(0);
      }
      throw error;
    });
    return closePromise;
  }

  const proxy = {
    subscribe,
    close,
    pauseAllAndDrain: close,
    listTasks: (params = {}) => request("taskOrchestratorTasksList", params),
    disconnect() { markDisconnected(Object.assign(new Error("Task Supervisor client disconnected"), { code: "SUPERVISOR_DISCONNECTED" })); },
    getSnapshot: () => request("supervisor.snapshot"),
    getActiveWork: () => request("supervisor.activeWork"),
    async getSupervisorHealth() {
      const remote = await request("supervisor.health");
      return { ...remote, watchdog: proxy.watchdogStatus(), lastCrash: await structuredLog.lastCrash() };
    },
    reportPowerEvent: (type, at = Date.now()) => request("supervisor.powerEvent", { type, at }, { retryOnDisconnect: false }),
    blockMutations(reason = "runtime_lifecycle") {
      if (closed || closing) {
        throw Object.assign(new Error("Task Supervisor client is closing or closed"), { code: "SUPERVISOR_CLIENT_CLOSED" });
      }
      const token = randomSupervisorStartToken();
      mutationBlocks.set(token, { reason: String(reason) });
      let released = false;
      return () => {
        if (released) return;
        released = true;
        mutationBlocks.delete(token);
      };
    },
    async awaitMutationsIdle() {
      while (mutationRequests.size > 0) {
        await Promise.allSettled([...mutationRequests]);
      }
    },
    ensureConnected: connect,
    startWatchdog() {
      if (closed || closing) throw Object.assign(new Error("Task Supervisor client is closing or closed"), { code: "SUPERVISOR_CLIENT_CLOSED" });
      if (watchdogEnabled) return;
      watchdogEnabled = true;
      watchdogGeneration += 1;
      scheduleWatchdog(0);
    },
    stopWatchdog() {
      watchdogEnabled = false;
      watchdogGeneration += 1;
      clearWatchdogTimer();
    },
    watchdogStatus: () => {
      const restartWindowCount = pruneWatchdogRestartHistory();
      return {
        enabled: watchdogEnabled,
        running: Boolean(watchdogInFlight),
        failures: watchdogFailures,
        restarts: watchdogRestarts,
        restartWindowCount,
        maxRestartsPerWindow: watchdogMaxRestarts,
        circuitOpen: restartWindowCount >= watchdogMaxRestarts,
        nextDelayMs: watchdogDelay(),
        lastError: watchdogLastError ? { ...watchdogLastError } : null,
      };
    },
    request,
    descriptor: () => descriptor,
    get supervisorEpoch() { return descriptor?.supervisorEpoch ?? null; },
    get rootDirectory() { return null; },
    _child: () => child,
    _descriptorPath: descriptorPath,
  };

  const methods = {
    taskOrchestratorTasksList: "taskOrchestratorTasksList",
    taskOrchestratorTaskGet: "taskOrchestratorTaskGet",
    taskOrchestratorRunsList: "taskOrchestratorRunsList",
    taskOrchestratorTurnHistoryList: "taskOrchestratorTurnHistoryList",
    taskOrchestratorEventsList: "taskOrchestratorEventsList",
    taskOrchestratorArtifactsList: "taskOrchestratorArtifactsList",
    taskOrchestratorArtifactGet: "taskOrchestratorArtifactGet",
    taskOrchestratorArtifactContentGet: "taskOrchestratorArtifactContentGet",
    taskOrchestratorTaskArchive: "taskOrchestratorTaskArchive",
    taskOrchestratorTaskRestore: "taskOrchestratorTaskRestore",
    taskOrchestratorTaskPurge: "taskOrchestratorTaskPurge",
    taskOrchestratorTaskExportManifest: "taskOrchestratorTaskExportManifest",
    taskOrchestratorMaintenanceRun: "taskOrchestratorMaintenanceRun",
    taskOrchestratorHealthGet: "taskOrchestratorHealthGet",
    taskOrchestratorOperationsDiagnosticsGet: "taskOrchestratorOperationsDiagnosticsGet",
    taskOrchestratorTaskCreate: "taskOrchestratorTaskCreate",
    taskOrchestratorTaskUpdate: "taskOrchestratorTaskUpdate",
    taskOrchestratorAlignmentMessage: "taskOrchestratorAlignmentMessage",
    taskOrchestratorAlignmentCancel: "taskOrchestratorAlignmentCancel",
    taskOrchestratorContractFinalize: "taskOrchestratorContractFinalize",
    taskOrchestratorTaskStart: "taskOrchestratorTaskStart",
    taskOrchestratorTaskStop: "taskOrchestratorTaskStop",
    taskOrchestratorTaskPause: "taskOrchestratorTaskPause",
    taskOrchestratorTaskResume: "taskOrchestratorTaskResume",
    taskOrchestratorPrimaryRetry: "taskOrchestratorPrimaryRetry",
    taskOrchestratorRecoveryContinue: "taskOrchestratorRecoveryContinue",
    taskOrchestratorNodeRetry: "taskOrchestratorNodeRetry",
    taskOrchestratorGateResolve: "taskOrchestratorGateResolve",
  };
  for (const [name, remoteMethod] of Object.entries(methods)) {
    proxy[name] = (params = {}) => request(remoteMethod, params);
  }
  proxy.listTasks = proxy.taskOrchestratorTasksList;
  proxy.getTask = proxy.taskOrchestratorTaskGet;
  proxy.listRuns = proxy.taskOrchestratorRunsList;
  proxy.listTurnHistory = proxy.taskOrchestratorTurnHistoryList;
  proxy.listEvents = proxy.taskOrchestratorEventsList;
  proxy.listArtifacts = proxy.taskOrchestratorArtifactsList;
  proxy.getArtifact = proxy.taskOrchestratorArtifactGet;
  proxy.getArtifactContent = proxy.taskOrchestratorArtifactContentGet;
  proxy.archiveTask = proxy.taskOrchestratorTaskArchive;
  proxy.restoreTask = proxy.taskOrchestratorTaskRestore;
  proxy.purgeTask = proxy.taskOrchestratorTaskPurge;
  proxy.exportTaskManifest = proxy.taskOrchestratorTaskExportManifest;
  proxy.runMaintenance = proxy.taskOrchestratorMaintenanceRun;
  proxy.getHealth = proxy.taskOrchestratorHealthGet;
  proxy.getOperationsDiagnostics = proxy.taskOrchestratorOperationsDiagnosticsGet;
  proxy.createTask = proxy.taskOrchestratorTaskCreate;
  proxy.updateTask = proxy.taskOrchestratorTaskUpdate;
  proxy.sendAlignmentMessage = proxy.taskOrchestratorAlignmentMessage;
  proxy.cancelAlignment = proxy.taskOrchestratorAlignmentCancel;
  proxy.finalizeContract = proxy.taskOrchestratorContractFinalize;
  proxy.startTask = proxy.taskOrchestratorTaskStart;
  proxy.stopRun = proxy.taskOrchestratorTaskStop;
  proxy.stopTask = proxy.taskOrchestratorTaskStop;
  proxy.pauseTask = proxy.taskOrchestratorTaskPause;
  proxy.resumeTask = proxy.taskOrchestratorTaskResume;
  proxy.retryPrimary = proxy.taskOrchestratorPrimaryRetry;
  proxy.continueRecovery = proxy.taskOrchestratorRecoveryContinue;
  proxy.retryNode = proxy.taskOrchestratorNodeRetry;
  proxy.resolveGate = proxy.taskOrchestratorGateResolve;
  return Object.freeze(proxy);
}

export { SUPERVISOR_ENTRYPOINT };
