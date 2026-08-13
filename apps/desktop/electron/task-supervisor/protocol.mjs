import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import os from "node:os";
import path from "node:path";

/**
 * The Supervisor transport is deliberately small: one JSON object per line,
 * authenticated before any method is dispatched.  It is a local control
 * channel, not a general purpose IPC bus, so frames are bounded and strict.
 */
export const TASK_SUPERVISOR_PROTOCOL_VERSION = 1;
export const TASK_SUPERVISOR_MAX_FRAME_BYTES = 1_048_576;
export const TASK_SUPERVISOR_DESCRIPTOR_VERSION = 1;

export const TASK_SUPERVISOR_METHODS = Object.freeze([
  "taskOrchestratorTasksList",
  "taskOrchestratorTaskGet",
  "taskOrchestratorRunsList",
  "taskOrchestratorTurnHistoryList",
  "taskOrchestratorEventsList",
  "taskOrchestratorArtifactsList",
  "taskOrchestratorArtifactGet",
  "taskOrchestratorArtifactContentGet",
  "taskOrchestratorTaskArchive",
  "taskOrchestratorTaskRestore",
  "taskOrchestratorTaskPurge",
  "taskOrchestratorTaskExportManifest",
  "taskOrchestratorMaintenanceRun",
  "taskOrchestratorHealthGet",
  "taskOrchestratorOperationsDiagnosticsGet",
  "taskOrchestratorTaskCreate",
  "taskOrchestratorTaskUpdate",
  "taskOrchestratorAlignmentMessage",
  "taskOrchestratorAlignmentCancel",
  "taskOrchestratorContractFinalize",
  "taskOrchestratorTaskStart",
  "taskOrchestratorTaskStop",
  "taskOrchestratorTaskPause",
  "taskOrchestratorTaskResume",
  "taskOrchestratorPrimaryRetry",
  "taskOrchestratorRecoveryContinue",
  "taskOrchestratorNodeRetry",
  "taskOrchestratorGateResolve",
]);

export const TASK_SUPERVISOR_METHOD_ALIASES = Object.freeze({
  taskOrchestratorTasksList: "listTasks",
  taskOrchestratorTaskGet: "getTask",
  taskOrchestratorRunsList: "listRuns",
  taskOrchestratorTurnHistoryList: "listTurnHistory",
  taskOrchestratorEventsList: "listEvents",
  taskOrchestratorArtifactsList: "listArtifacts",
  taskOrchestratorArtifactGet: "getArtifact",
  taskOrchestratorArtifactContentGet: "getArtifactContent",
  taskOrchestratorTaskArchive: "archiveTask",
  taskOrchestratorTaskRestore: "restoreTask",
  taskOrchestratorTaskPurge: "purgeTask",
  taskOrchestratorTaskExportManifest: "exportTaskManifest",
  taskOrchestratorMaintenanceRun: "runMaintenance",
  taskOrchestratorHealthGet: "getHealth",
  taskOrchestratorOperationsDiagnosticsGet: "getOperationsDiagnostics",
  taskOrchestratorTaskCreate: "createTask",
  taskOrchestratorTaskUpdate: "updateTask",
  taskOrchestratorAlignmentMessage: "sendAlignmentMessage",
  taskOrchestratorAlignmentCancel: "cancelAlignment",
  taskOrchestratorContractFinalize: "finalizeContract",
  taskOrchestratorTaskStart: "startTask",
  taskOrchestratorTaskStop: "stopRun",
  taskOrchestratorTaskPause: "pauseTask",
  taskOrchestratorTaskResume: "resumeTask",
  taskOrchestratorPrimaryRetry: "retryPrimary",
  taskOrchestratorRecoveryContinue: "continueRecovery",
  taskOrchestratorNodeRetry: "retryNode",
  taskOrchestratorGateResolve: "resolveGate",
});

const HEX_SECRET = /^[a-f0-9]{64}$/i;

export function randomSupervisorSecret() {
  return randomBytes(32).toString("hex");
}

export function randomSupervisorEpoch() {
  return randomUUID();
}

export function randomSupervisorStartToken() {
  return randomUUID();
}

/**
 * Unix domain sockets have a short platform-specific pathname limit.  Keep
 * the stable identity in userData, but put the endpoint in tmp using a hash so
 * deeply nested app/userData paths remain connectable.  Windows named pipes
 * have the same stable hash identity and do not need a filesystem cleanup.
 */
export function supervisorEndpointForUserData(
  userDataDir,
  { platform = process.platform, tempDir = os.tmpdir() } = {},
) {
  const normalized = path.resolve(String(userDataDir ?? ""));
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 32);
  if (platform === "win32") {
    return `\\\\.\\pipe\\onmyagent-task-supervisor-${digest}`;
  }
  const root = path.resolve(String(tempDir || os.tmpdir()));
  const filename = `onmyagent-task-supervisor-${digest}.sock`;
  const candidate = path.join(root, filename);
  // macOS commonly returns a deeply nested per-user tmp path.  AF_UNIX on
  // Darwin rejects paths at roughly 104 bytes, so use the stable /tmp mount
  // when the normal candidate would cross that limit.
  return candidate.length < 100 && candidate.length > 0
    ? candidate
    : path.join("/tmp", filename);
}

export function supervisorDescriptorPaths(userDataDir) {
  const root = path.join(path.resolve(String(userDataDir ?? "")), "task-supervisor");
  return Object.freeze({
    root,
    descriptorPath: path.join(root, "descriptor.json"),
    secretPath: path.join(root, "secret"),
  });
}

export function isValidSupervisorSecret(value) {
  return HEX_SECRET.test(String(value ?? ""));
}

export function secretsEqual(left, right) {
  const a = Buffer.from(String(left ?? ""), "utf8");
  const b = Buffer.from(String(right ?? ""), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * @param {{
 *   userDataDir?: string,
 *   endpoint?: string,
 *   pid?: number,
 *   supervisorEpoch?: string,
 *   startToken?: string,
 *   protocolVersion?: number,
 *   secretPath?: string,
 *   createdAt?: number,
 * }} options
 */
export function createSupervisorDescriptor({
  userDataDir,
  endpoint = supervisorEndpointForUserData(userDataDir),
  pid = process.pid,
  supervisorEpoch = randomSupervisorEpoch(),
  startToken = randomSupervisorStartToken(),
  protocolVersion = TASK_SUPERVISOR_PROTOCOL_VERSION,
  secretPath = supervisorDescriptorPaths(userDataDir).secretPath,
  createdAt = Date.now(),
} = {}) {
  if (!userDataDir) throw new Error("Task Supervisor userDataDir is required");
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) {
    throw new Error("Task Supervisor descriptor pid is invalid");
  }
  return Object.freeze({
    descriptorVersion: TASK_SUPERVISOR_DESCRIPTOR_VERSION,
    protocolVersion,
    supervisorEpoch: String(supervisorEpoch),
    startToken: String(startToken),
    pid: Number(pid),
    endpoint: String(endpoint),
    userDataDir: path.resolve(String(userDataDir)),
    secretPath: path.resolve(String(secretPath)),
    createdAt: Number(createdAt),
  });
}

/**
 * Validate a frame without dispatching it.  `Buffer` input is accepted so the
 * decoder can reject an oversized frame before allocating/parsing JSON.
 */
export function parseSupervisorFrame(input, { maxBytes = TASK_SUPERVISOR_MAX_FRAME_BYTES } = {}) {
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ""), "utf8");
  if (raw.length > maxBytes) {
    throw Object.assign(new Error("Task Supervisor frame exceeds the maximum size"), { code: "SUPERVISOR_FRAME_TOO_LARGE" });
  }
  const text = raw.toString("utf8").trim();
  if (!text) {
    throw Object.assign(new Error("Task Supervisor frame is empty"), { code: "SUPERVISOR_MALFORMED_FRAME" });
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw Object.assign(new Error("Task Supervisor frame is not valid JSON", { cause }), { code: "SUPERVISOR_MALFORMED_FRAME" });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("Task Supervisor frame must be a JSON object"), { code: "SUPERVISOR_MALFORMED_FRAME" });
  }
  if (Number(value.protocolVersion) !== TASK_SUPERVISOR_PROTOCOL_VERSION) {
    throw Object.assign(new Error("Task Supervisor protocol version is unsupported"), { code: "SUPERVISOR_PROTOCOL_MISMATCH" });
  }
  if (typeof value.type !== "string" || !value.type) {
    throw Object.assign(new Error("Task Supervisor frame type is required"), { code: "SUPERVISOR_MALFORMED_FRAME" });
  }
  return value;
}

export function encodeSupervisorFrame(frame) {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
    throw new Error("Task Supervisor frame must be an object");
  }
  const value = { protocolVersion: TASK_SUPERVISOR_PROTOCOL_VERSION, ...frame };
  const encoded = `${JSON.stringify(value)}\n`;
  if (Buffer.byteLength(encoded, "utf8") > TASK_SUPERVISOR_MAX_FRAME_BYTES) {
    throw Object.assign(new Error("Task Supervisor frame exceeds the maximum size"), { code: "SUPERVISOR_FRAME_TOO_LARGE" });
  }
  return encoded;
}

/** @param {{onFrame?: (frame: Record<string, unknown>) => void, onError?: (error: unknown) => void, maxBytes?: number}} options */
export function createSupervisorFrameDecoder({
  onFrame,
  onError,
  maxBytes = TASK_SUPERVISOR_MAX_FRAME_BYTES,
} = {}) {
  if (typeof onFrame !== "function") throw new Error("Task Supervisor frame decoder onFrame is required");
  let buffer = Buffer.alloc(0);
  let stopped = false;
  return {
    push(chunk) {
      if (stopped) return;
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buffer = Buffer.concat([buffer, incoming]);
      if (buffer.length > maxBytes && !buffer.includes(0x0a)) {
        const error = Object.assign(new Error("Task Supervisor frame exceeds the maximum size"), { code: "SUPERVISOR_FRAME_TOO_LARGE" });
        stopped = true;
        onError?.(error);
        return;
      }
      while (!stopped) {
        const newline = buffer.indexOf(0x0a);
        if (newline < 0) break;
        const line = buffer.subarray(0, newline);
        buffer = buffer.subarray(newline + 1);
        try {
          onFrame(parseSupervisorFrame(line, { maxBytes }));
        } catch (error) {
          stopped = true;
          onError?.(error);
        }
      }
      if (buffer.length > maxBytes) {
        const error = Object.assign(new Error("Task Supervisor frame exceeds the maximum size"), { code: "SUPERVISOR_FRAME_TOO_LARGE" });
        stopped = true;
        onError?.(error);
      }
    },
    stop() {
      stopped = true;
      buffer = Buffer.alloc(0);
    },
  };
}
