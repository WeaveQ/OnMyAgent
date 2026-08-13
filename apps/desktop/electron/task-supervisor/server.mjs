import net from "node:net";
import { createHash } from "node:crypto";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  TASK_SUPERVISOR_METHOD_ALIASES,
  TASK_SUPERVISOR_PROTOCOL_VERSION,
  createSupervisorDescriptor,
  createSupervisorFrameDecoder,
  encodeSupervisorFrame,
  isValidSupervisorSecret,
  parseSupervisorFrame,
  randomSupervisorEpoch,
  randomSupervisorSecret,
  randomSupervisorStartToken,
  secretsEqual,
  supervisorDescriptorPaths,
  supervisorEndpointForUserData,
} from "./protocol.mjs";

const UNIX_SOCKET_MODE = 0o600;
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const execFileAsync = promisify(nodeExecFile);

function messageOf(error) {
  return error instanceof Error ? error.message : String(error ?? "Unknown Supervisor error");
}

function errorRecord(error, fallbackCode = "SUPERVISOR_REQUEST_FAILED") {
  return {
    code: String(error?.code ?? fallbackCode),
    message: messageOf(error),
  };
}

function descriptorShape(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Number(value.protocolVersion) !== TASK_SUPERVISOR_PROTOCOL_VERSION) return null;
  if (!Number.isInteger(Number(value.pid)) || Number(value.pid) <= 0) return null;
  if (typeof value.endpoint !== "string" || !value.endpoint) return null;
  if (typeof value.supervisorEpoch !== "string" || !value.supervisorEpoch) return null;
  if (typeof value.startToken !== "string" || !value.startToken) return null;
  if (typeof value.secretPath !== "string" || !value.secretPath) return null;
  return Object.freeze({ ...value, pid: Number(value.pid) });
}

export async function readSupervisorDescriptor(descriptorPath) {
  try {
    const raw = await readFile(descriptorPath, "utf8");
    return descriptorShape(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function readSupervisorSecret(secretPath) {
  try {
    const secret = (await readFile(secretPath, "utf8")).trim();
    return isValidSupervisorSecret(secret) ? secret : null;
  } catch {
    return null;
  }
}

export async function hardenWindowsSupervisorAcl(targets, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return { applied: false, platform };
  const execFileFn = options.execFileFn ?? execFileAsync;
  const identity = await execFileFn("whoami", ["/user", "/fo", "csv", "/nh"], { windowsHide: true });
  const sid = String(identity?.stdout ?? identity ?? "").match(/S-1-[0-9-]+/i)?.[0];
  if (!sid) throw Object.assign(new Error("Unable to resolve the current Windows user SID for Task Supervisor ACL"), { code: "SUPERVISOR_ACL_IDENTITY_FAILED" });
  const uniqueTargets = [...new Set((Array.isArray(targets) ? targets : [targets]).map((item) => path.resolve(String(item))))];
  for (const target of uniqueTargets) {
    const isDirectory = target === uniqueTargets[0];
    const grant = isDirectory ? `*${sid}:(OI)(CI)F` : `*${sid}:F`;
    await execFileFn("icacls", [target, "/inheritance:r", "/grant:r", grant], { windowsHide: true });
  }
  return { applied: true, sid, targetCount: uniqueTargets.length };
}

export async function writeSupervisorDescriptor(descriptorPath, descriptor, secret, options = {}) {
  if (!isValidSupervisorSecret(secret)) throw new Error("Task Supervisor secret must be a 256-bit token");
  await mkdir(path.dirname(descriptorPath), { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  await chmod(path.dirname(descriptorPath), PRIVATE_DIRECTORY_MODE).catch(() => undefined);
  await hardenWindowsSupervisorAcl(path.dirname(descriptorPath), options);
  const secretPath = descriptor.secretPath;
  const secretTemp = `${secretPath}.${process.pid}.tmp`;
  const descriptorTemp = `${descriptorPath}.${process.pid}.tmp`;
  await writeFile(secretTemp, `${secret}\n`, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  await chmod(secretTemp, PRIVATE_FILE_MODE).catch(() => undefined);
  await rename(secretTemp, secretPath);
  await hardenWindowsSupervisorAcl([path.dirname(descriptorPath), secretPath], options);
  await writeFile(descriptorTemp, `${JSON.stringify(descriptor)}\n`, { encoding: "utf8", mode: PRIVATE_FILE_MODE });
  await chmod(descriptorTemp, PRIVATE_FILE_MODE).catch(() => undefined);
  await rename(descriptorTemp, descriptorPath);
  await chmod(descriptorPath, PRIVATE_FILE_MODE).catch(() => undefined);
  await hardenWindowsSupervisorAcl([path.dirname(descriptorPath), descriptorPath], options);
  return descriptor;
}

/** @param {{descriptorPath?: string, secretPath?: string | null, endpoint?: string | null, platform?: NodeJS.Platform}} options */
export async function cleanupSupervisorDescriptor({
  descriptorPath,
  secretPath,
  endpoint,
  platform = process.platform,
} = {}) {
  await rm(descriptorPath, { force: true }).catch(() => undefined);
  if (secretPath) await rm(secretPath, { force: true }).catch(() => undefined);
  if (platform !== "win32" && endpoint) await rm(endpoint, { force: true }).catch(() => undefined);
}

export function isSupervisorProcessAlive(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return false;
  try {
    process.kill(value, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe a descriptor without trusting PID alone.  A reused PID is not enough
 * to keep stale state alive: the endpoint must complete the epoch/start-token
 * handshake with the descriptor's private secret.
 */
/**
 * @param {{endpoint: string, supervisorEpoch: string, startToken: string}} descriptor
 * @param {{secret?: string | null, timeoutMs?: number, netConnect?: (endpoint: string) => import("node:net").Socket}} options
 */
export async function probeSupervisorEndpoint(descriptor, {
  secret,
  timeoutMs = 250,
  netConnect = net.createConnection,
} = {}) {
  if (!descriptor || !isValidSupervisorSecret(secret)) return false;
  return new Promise((resolve) => {
    let settled = false;
    let socket;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket?.destroy(); } catch { /* best effort */ }
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), Math.max(1, Number(timeoutMs) || 250));
    timer.unref?.();
    try {
      socket = netConnect(descriptor.endpoint);
      const decoder = createSupervisorFrameDecoder({
        onFrame(frame) {
          finish(
            frame.type === "hello" &&
              frame.ok === true &&
              frame.supervisorEpoch === descriptor.supervisorEpoch &&
              frame.startToken === descriptor.startToken,
          );
        },
        onError: () => finish(false),
      });
      socket.once("error", () => finish(false));
      socket.once("close", () => finish(false));
      socket.on("data", (chunk) => decoder.push(chunk));
      socket.once("connect", () => {
        try {
          socket.write(encodeSupervisorFrame({
            type: "hello",
            id: `probe-${process.pid}-${Date.now()}`,
            token: secret,
            supervisorEpoch: descriptor.supervisorEpoch,
            startToken: descriptor.startToken,
          }));
        } catch {
          finish(false);
        }
      });
    } catch {
      finish(false);
    }
  });
}

function fingerprint(request) {
  return JSON.stringify({ method: request.method, params: request.params ?? null });
}

function requestDigest(request) {
  return createHash("sha256").update(fingerprint(request)).digest("hex");
}

function serviceSnapshot(service) {
  if (typeof service.snapshot === "function") return service.snapshot();
  if (typeof service.listTasks === "function") return service.listTasks({});
  return { tasks: [] };
}

/**
 * Authenticated local server used by the detached Node-mode Electron child.
 * The service object is intentionally injected: the current JSON store can be
 * used today and the SQLite/WAL worker can provide the same orchestrator
 * surface later without changing this process boundary.
 */
export function createTaskSupervisorServer(options = {}) {
  const configuredUserDataDir = String(options.userDataDir ?? "").trim();
  if (!configuredUserDataDir) throw new Error("Task Supervisor userDataDir is required");
  const userDataDir = path.resolve(configuredUserDataDir);
  const paths = supervisorDescriptorPaths(userDataDir);
  const descriptorPath = options.descriptorPath ?? paths.descriptorPath;
  const secretPath = options.secretPath ?? paths.secretPath;
  const endpoint = options.endpoint ?? supervisorEndpointForUserData(userDataDir, options);
  const platform = options.platform ?? process.platform;
  const service = options.service;
  if (!service || typeof service !== "object") throw new Error("Task Supervisor service is required");
  const netServerFactory = options.netServerFactory ?? ((handler) => net.createServer(handler));
  const now = options.now ?? Date.now;
  const requestTimeoutMs = Math.max(100, Number(options.requestTimeoutMs) || DEFAULT_REQUEST_TIMEOUT_MS);
  const secret = options.secret ?? randomSupervisorSecret();
  const supervisorEpoch = options.supervisorEpoch ?? randomSupervisorEpoch();
  const startToken = options.startToken ?? randomSupervisorStartToken();
  const clients = new Set();
  const requestCache = new Map();
  let server = null;
  let descriptor = null;
  let started = false;
  let stopped = false;
  let sequence = 0;
  let unsubscribe = null;
  let shutdownPromise = null;

  function send(socket, frame) {
    if (socket.destroyed) return false;
    try {
      socket.write(encodeSupervisorFrame({
        supervisorEpoch,
        startToken,
        ...frame,
      }));
      return true;
    } catch (error) {
      socket.destroy(error);
      return false;
    }
  }

  function broadcast(event) {
    if (stopped) return false;
    sequence += 1;
    const frame = {
      type: "event",
      sequence,
      event,
      at: now(),
    };
    let delivered = false;
    for (const client of [...clients]) {
      if (!client.authenticated) continue;
      delivered = send(client.socket, frame) || delivered;
    }
    return delivered;
  }

  async function dispatch(method, params, socket) {
    if (method === "supervisor.snapshot") {
      const snapshot = await serviceSnapshot(service);
      return { snapshot, sequence };
    }
    if (method === "supervisor.shutdown") {
      const reason = String(params?.reason ?? "explicit_quit");
      await pauseAllAndDrain(reason);
      return { ok: true, reason, supervisorEpoch };
    }
    if (method === "supervisor.activeWork") {
      if (typeof service.activeWorkStatus !== "function") {
        return { active: false, activeCount: 0, tasks: [], truncated: false };
      }
      return service.activeWorkStatus();
    }
    if (method === "supervisor.health") {
      if (typeof service.operationalHealth !== "function") return { supervisorEpoch, observedAt: now() };
      return service.operationalHealth();
    }
    if (method === "supervisor.powerEvent") {
      if (typeof service.recordPowerEvent !== "function") return { ok: false, unsupported: true };
      return service.recordPowerEvent(params ?? {});
    }
    const target = TASK_SUPERVISOR_METHOD_ALIASES[method] ?? method;
    if (!target || typeof service[target] !== "function") {
      throw Object.assign(new Error(`Task Supervisor method is not implemented: ${method}`), { code: "SUPERVISOR_METHOD_NOT_FOUND" });
    }
    return service[target](params ?? {});
  }

  async function handleRequest(client, frame) {
    const id = String(frame.id ?? "").trim();
    if (!id) throw Object.assign(new Error("Task Supervisor request id is required"), { code: "SUPERVISOR_MALFORMED_FRAME" });
    const key = String(frame.idempotencyKey ?? id);
    const digest = fingerprint(frame);
    const cached = requestCache.get(key);
    if (cached) {
      if (cached.digest !== digest) {
        throw Object.assign(new Error("Task Supervisor idempotency key was reused for a different request"), { code: "SUPERVISOR_IDEMPOTENCY_CONFLICT" });
      }
      return cached.promise;
    }
    const promise = Promise.resolve().then(async () => {
      const method = String(frame.method ?? "");
      const durable = !method.startsWith("supervisor.")
        && typeof service.claimSupervisorRequest === "function"
        && typeof service.completeSupervisorRequest === "function"
        && typeof service.failSupervisorRequest === "function";
      const digest = requestDigest(frame);
      if (durable) {
        const claim = await service.claimSupervisorRequest({ idempotencyKey: key, requestDigest: digest, ownerEpoch: supervisorEpoch });
        if (claim?.state === "completed") return { ok: true, result: claim.result };
        if (claim?.state === "failed") return { ok: false, error: claim.error };
        if (claim?.state === "processing") {
          return { ok: false, error: { code: "SUPERVISOR_REQUEST_IN_PROGRESS", message: "The same Supervisor request is still running" } };
        }
        if (claim?.state === "unknown") {
          return { ok: false, error: { code: "SUPERVISOR_REQUEST_OUTCOME_UNKNOWN", message: "The previous Supervisor stopped before it durably recorded the request outcome; the operation was not replayed" } };
        }
      }
      let result;
      try {
        result = await dispatch(method, frame.params ?? {}, client.socket);
      } catch (error) {
        if (durable) {
          try {
            await service.failSupervisorRequest({ idempotencyKey: key, requestDigest: digest, ownerEpoch: supervisorEpoch, error: errorRecord(error) });
          } catch (persistenceError) {
            return { ok: false, error: errorRecord(persistenceError, "SUPERVISOR_FAILURE_PERSIST_FAILED") };
          }
        }
        return { ok: false, error: errorRecord(error) };
      }
      if (durable) {
        try {
          await service.completeSupervisorRequest({ idempotencyKey: key, requestDigest: digest, ownerEpoch: supervisorEpoch, result });
        } catch (error) {
          return { ok: false, error: errorRecord(error, "SUPERVISOR_RESULT_PERSIST_FAILED") };
        }
      }
      return { ok: true, result };
    }).catch((error) => ({ ok: false, error: errorRecord(error) }));
    requestCache.set(key, { digest, promise, createdAt: now() });
    // Keep the cache bounded.  Entries are retained for the lifetime of the
    // Supervisor, which is enough to fence retries after a client reconnect.
    while (requestCache.size > 2_000) {
      requestCache.delete(requestCache.keys().next().value);
    }
    return promise;
  }

  async function pauseAllAndDrain(reason = "explicit_quit") {
    if (shutdownPromise) return shutdownPromise;
    const operation = (async () => {
      const method = typeof service.pauseAllAndDrain === "function"
        ? service.pauseAllAndDrain.bind(service)
        : typeof service.close === "function" ? service.close.bind(service) : null;
      if (!method) throw new Error("Task Supervisor service cannot pause and drain");
      // A reason string is the stable service contract.  Test doubles and the
      // future SQLite implementation can persist it in the pause record.
      await method(reason);
      return { ok: true, reason };
    })();
    shutdownPromise = operation.catch((error) => {
      shutdownPromise = null;
      throw error;
    });
    return shutdownPromise;
  }

  function onSocket(socket) {
    // A reconnect can be accepted in the narrow window after stop() has
    // fenced the server but before net.Server.close() has stopped accepting.
    // Leaving that late socket open makes close() wait forever and keeps the
    // old Supervisor process (and its SQLite writer) alive beside its
    // replacement.
    if (stopped) {
      try { socket.destroy(); } catch { /* the stopped boundary is best effort */ }
      return;
    }
    const client = { socket, authenticated: false, closed: false };
    clients.add(client);
    socket.setNoDelay?.(true);
    const decoder = createSupervisorFrameDecoder({
      onFrame: (frame) => { void onFrame(client, frame); },
      onError: (error) => {
        send(socket, { type: "error", id: null, ok: false, error: errorRecord(error) });
        socket.destroy();
      },
    });
    socket.on("data", (chunk) => decoder.push(chunk));
    socket.once("error", () => { client.closed = true; });
    socket.once("close", () => {
      client.closed = true;
      decoder.stop();
      clients.delete(client);
    });
  }

  async function onFrame(client, frame) {
    if (client.closed || stopped) return;
    const socket = client.socket;
    if (!client.authenticated) {
      if (frame.type !== "hello") {
        send(socket, { type: "hello", id: frame.id ?? null, ok: false, error: { code: "SUPERVISOR_AUTH_REQUIRED", message: "Supervisor hello is required" } });
        socket.destroy();
        return;
      }
      const tokenMatches = secretsEqual(frame.token, secret);
      const epochMatches = frame.supervisorEpoch === supervisorEpoch;
      const startMatches = frame.startToken === startToken;
      if (!tokenMatches || !epochMatches || !startMatches) {
        const code = tokenMatches ? "SUPERVISOR_EPOCH_MISMATCH" : "SUPERVISOR_AUTH_FAILED";
        send(socket, { type: "hello", id: frame.id ?? null, ok: false, error: { code, message: code === "SUPERVISOR_AUTH_FAILED" ? "Task Supervisor token is invalid" : "Task Supervisor epoch or start token is stale" } });
        socket.destroy();
        return;
      }
      client.authenticated = true;
      send(socket, { type: "hello", id: frame.id ?? null, ok: true, protocolVersion: TASK_SUPERVISOR_PROTOCOL_VERSION });
      // Replay after authentication, when at least this client can receive
      // the durable event. A replay attempted during listen() before any
      // client connects would otherwise acknowledge an outbox row without a
      // real recipient.
      if (typeof service.replayOutbox === "function") {
        await service.replayOutbox({ reason: "supervisor-client-connected" });
      }
      return;
    }
    if (frame.supervisorEpoch !== supervisorEpoch || frame.startToken !== startToken) {
      send(socket, { type: "response", id: frame.id ?? null, ok: false, error: { code: "SUPERVISOR_EPOCH_MISMATCH", message: "Task Supervisor epoch or start token is stale" } });
      socket.destroy();
      return;
    }
    if (frame.type !== "request") {
      send(socket, { type: "error", id: frame.id ?? null, ok: false, error: { code: "SUPERVISOR_MALFORMED_FRAME", message: "Task Supervisor request frame is required" } });
      return;
    }
    const result = await handleRequest(client, frame);
    send(socket, { type: "response", id: frame.id, ...result });
    if (frame.method === "supervisor.shutdown" && result.ok) {
      // Flush the response before closing the transport.  The child process
      // exits after stop() has removed its descriptor and endpoint.
      setImmediate(() => { void stop(); });
    }
  }

  async function listen() {
    if (started) return descriptor;
    if (stopped) throw new Error("Task Supervisor server is stopped");
    const existing = await readSupervisorDescriptor(descriptorPath);
    if (existing) {
      const existingSecret = await readSupervisorSecret(existing.secretPath);
      if (isSupervisorProcessAlive(existing.pid) && await probeSupervisorEndpoint(existing, { secret: existingSecret })) {
        throw Object.assign(new Error("Task Supervisor is already running"), { code: "SUPERVISOR_ALREADY_RUNNING" });
      }
      await cleanupSupervisorDescriptor({ descriptorPath, secretPath: existing.secretPath, endpoint: existing.endpoint, platform });
    }
    if (platform !== "win32") await rm(endpoint, { force: true }).catch(() => undefined);
    descriptor = createSupervisorDescriptor({
      userDataDir,
      endpoint,
      pid: process.pid,
      supervisorEpoch,
      startToken,
      secretPath,
    });
    server = netServerFactory(onSocket);
    await new Promise((resolve, reject) => {
      const onError = (error) => { server?.off("listening", onListening); reject(error); };
      const onListening = () => { server?.off("error", onError); resolve(); };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(endpoint);
    });
    if (platform !== "win32") await chmod(endpoint, UNIX_SOCKET_MODE).catch(() => undefined);
    await writeSupervisorDescriptor(descriptorPath, descriptor, secret, {
      platform,
      execFileFn: options.execFileFn,
    });
    started = true;
    unsubscribe = typeof service.subscribe === "function" ? service.subscribe((event) => broadcast(event)) : null;
    // Subscribe before replaying so events committed in the crash window
    // (SQLite commit succeeded, socket broadcast did not) are delivered to
    // reconnecting clients exactly once per durable outbox acknowledgement.
    if (typeof service.replayOutbox === "function" && clients.size > 0) {
      await service.replayOutbox({ reason: "supervisor-startup" });
    }
    return descriptor;
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    try { unsubscribe?.(); } catch { /* listener cleanup is best effort */ }
    unsubscribe = null;
    for (const client of [...clients]) {
      try { client.socket.destroy(); } catch { /* best effort */ }
    }
    clients.clear();
    if (server) await new Promise((resolve) => server.close(() => resolve())).catch(() => undefined);
    await cleanupSupervisorDescriptor({ descriptorPath, secretPath, endpoint, platform });
    server = null;
  }

  async function handleSignal(signal) {
    try {
      await pauseAllAndDrain(signal === "SIGTERM" ? "supervisor_term" : "supervisor_interrupt");
      await stop();
    } catch (error) {
      // Do not claim a clean drain.  The process exits non-zero and the stale
      // descriptor is removed only after transport teardown.
      console.error(`[task-supervisor] ${signal} drain failed:`, messageOf(error));
      process.exitCode = 1;
      await stop();
    }
  }

  return Object.freeze({
    listen,
    start: listen,
    stop,
    close: stop,
    pauseAllAndDrain,
    descriptor: () => descriptor,
    endpoint,
    descriptorPath,
    secretPath,
    get sequence() { return sequence; },
    handleSignal,
    _onSocket: onSocket,
  });
}
