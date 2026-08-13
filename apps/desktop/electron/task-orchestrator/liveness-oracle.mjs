// @ts-check

/**
 * Evidence-based liveness classification for Task Center runtime attempts.
 *
 * This module deliberately performs no process inspection itself. Callers may
 * pass an observation and/or inject bounded probes. A failed, timed-out, or
 * malformed probe always produces UNKNOWN, which is never a termination
 * recommendation.
 */

export const LIVENESS_VERDICT = Object.freeze({
  WORKING: "WORKING",
  DEAD: "DEAD",
  STUCK_INPUT: "STUCK_INPUT",
  UNKNOWN: "UNKNOWN",
});

const DEFAULT_STALL_AFTER_MS = 60_000;
const DEFAULT_CHILD_EXIT_GRACE_MS = 3_000;
const DEFAULT_PROBE_TIMEOUT_MS = 250;
const MAX_DURATION_MS = 24 * 60 * 60 * 1_000;
const MAX_EVIDENCE_ITEMS = 10;
const MAX_EVIDENCE_NUMBER = 1_000_000_000_000;
const PROBE_NAMES = Object.freeze(["process", "child", "wait", "stdin", "socket", "activity"]);
const NESTED_OBSERVATION_KEYS = Object.freeze([
  "process",
  "child",
  "declaredWait",
  "stdin",
  "socket",
  "activity",
  "exclusions",
]);

/** @param {unknown} value */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
function record(value) {
  return isRecord(value) ? /** @type {Record<string, unknown>} */ (value) : {};
}

/** @param {unknown} value @param {number} fallback */
function boundedDuration(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(MAX_DURATION_MS, Math.max(1, Math.round(number)))
    : fallback;
}

/** @param {unknown} value */
function boundedEvidenceNumber(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(MAX_EVIDENCE_NUMBER, Math.max(0, Math.round(number)))
    : undefined;
}

/**
 * Only stable, internally-generated codes and bounded numeric values are
 * returned. Raw probe data and error messages are never copied to diagnostics.
 *
 * @param {Array<Record<string, unknown>>} evidence
 */
function sanitizeEvidence(evidence) {
  return Object.freeze(evidence.slice(0, MAX_EVIDENCE_ITEMS).map((item) => {
    const sanitized = { code: String(item.code ?? "unknown").slice(0, 64) };
    if (PROBE_NAMES.includes(String(item.probe))) sanitized.probe = String(item.probe);
    for (const key of ["activeIdleMs", "ageMs", "graceRemainingMs", "cpuDeltaMs", "ioDeltaBytes"]) {
      const value = boundedEvidenceNumber(item[key]);
      if (value !== undefined) sanitized[key] = value;
    }
    return Object.freeze(sanitized);
  }));
}

/**
 * @param {keyof typeof LIVENESS_VERDICT} verdictKey
 * @param {string} reason
 * @param {number} observedAt
 * @param {number | null} activeIdleMs
 * @param {Array<Record<string, unknown>>} evidence
 */
function result(verdictKey, reason, observedAt, activeIdleMs, evidence) {
  const verdict = LIVENESS_VERDICT[verdictKey];
  return Object.freeze({
    verdict,
    reason,
    observedAt,
    activeIdleMs: activeIdleMs === null ? null : boundedEvidenceNumber(activeIdleMs) ?? null,
    terminationRecommended: verdict === LIVENESS_VERDICT.DEAD || verdict === LIVENESS_VERDICT.STUCK_INPUT,
    evidence: sanitizeEvidence(evidence),
  });
}

/** @param {unknown} now */
function resolveNow(now) {
  try {
    const value = typeof now === "function" ? now() : (now ?? Date.now());
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
  } catch {
    return null;
  }
}

/** @param {Record<string, unknown>} source @param {string} key @param {string[]} errors @param {string} code */
function optionalBoolean(source, key, errors, code) {
  if (!(key in source)) return null;
  if (typeof source[key] === "boolean") return source[key];
  errors.push(code);
  return null;
}

/** @param {Record<string, unknown>} source @param {string} key @param {string[]} errors @param {string} code */
function optionalNonNegativeNumber(source, key, errors, code) {
  if (!(key in source)) return null;
  const value = Number(source[key]);
  if (Number.isFinite(value) && value >= 0) return value;
  errors.push(code);
  return null;
}

/**
 * @param {Record<string, unknown>} source
 * @param {string} key
 * @param {readonly string[]} allowed
 * @param {string[]} errors
 * @param {string} code
 */
function optionalEnum(source, key, allowed, errors, code) {
  if (!(key in source)) return null;
  const value = String(source[key] ?? "");
  if (allowed.includes(value)) return value;
  errors.push(code);
  return null;
}

/**
 * @param {unknown} input
 * @param {number} observedAt
 */
function normalizeObservation(input, observedAt) {
  if (!isRecord(input)) return { errors: ["invalid-observation"] };
  const root = record(input);
  const process = record(root.process);
  const child = record(root.child);
  const wait = record(root.declaredWait);
  const stdin = record(root.stdin);
  const socket = record(root.socket);
  const activity = record(root.activity);
  const exclusions = record(root.exclusions);
  const errors = [];

  let pid = null;
  if ("pid" in process) {
    const candidate = Number(process.pid);
    if (Number.isInteger(candidate) && candidate > 0) pid = candidate;
    else errors.push("invalid-pid");
  }
  const processState = optionalEnum(process, "state", ["running", "exited", "missing", "unknown"], errors, "invalid-process-state");
  const childState = optionalEnum(child, "state", ["running", "exited", "none", "unknown"], errors, "invalid-child-state");
  const childExitedAt = optionalNonNegativeNumber(child, "exitedAt", errors, "invalid-child-exit-time");
  const waitActive = optionalBoolean(wait, "active", errors, "invalid-wait-state");
  const waitKind = optionalEnum(wait, "kind", ["wait", "approval", "sleep", "tool"], errors, "invalid-wait-kind");
  const waitUntil = optionalNonNegativeNumber(wait, "until", errors, "invalid-wait-until");
  const stdinWaiting = optionalBoolean(stdin, "waiting", errors, "invalid-stdin-state");
  const socketEstablished = optionalBoolean(socket, "established", errors, "invalid-socket-state");
  const socketMoving = optionalBoolean(socket, "moving", errors, "invalid-socket-movement");
  const cpuDeltaMs = optionalNonNegativeNumber(activity, "cpuDeltaMs", errors, "invalid-cpu-delta");
  const ioDeltaBytes = optionalNonNegativeNumber(activity, "ioDeltaBytes", errors, "invalid-io-delta");
  const lastProgressAt = optionalNonNegativeNumber(activity, "lastProgressAt", errors, "invalid-progress-time");
  const sleepMs = optionalNonNegativeNumber(exclusions, "sleepMs", errors, "invalid-sleep-exclusion") ?? 0;
  const approvalMs = optionalNonNegativeNumber(exclusions, "approvalMs", errors, "invalid-approval-exclusion") ?? 0;

  if (childExitedAt !== null && childExitedAt > observedAt) errors.push("future-child-exit-time");
  if (lastProgressAt !== null && lastProgressAt > observedAt) errors.push("future-progress-time");
  if (waitUntil !== null && waitUntil < 0) errors.push("invalid-wait-until");

  const activeIdleMs = lastProgressAt === null
    ? null
    : Math.max(0, observedAt - lastProgressAt - sleepMs - approvalMs);

  return {
    errors,
    pid,
    processState,
    childState,
    childExitedAt,
    waitActive,
    waitKind,
    waitUntil,
    stdinWaiting,
    socketEstablished,
    socketMoving,
    cpuDeltaMs,
    ioDeltaBytes,
    lastProgressAt,
    activeIdleMs,
  };
}

/**
 * Classify an already-observed attempt. It is safe to call with malformed or
 * incomplete input: uncertain evidence produces UNKNOWN.
 *
 * @param {unknown} input
 * @param {{now?: number | (() => number), stallAfterMs?: number, childExitGraceMs?: number}} [options]
 */
export function classifyLiveness(input, options = {}) {
  const observedAt = resolveNow(options.now);
  if (observedAt === null) return result("UNKNOWN", "invalid-clock", 0, null, [{ code: "invalid-clock" }]);
  const stallAfterMs = boundedDuration(options.stallAfterMs, DEFAULT_STALL_AFTER_MS);
  const childExitGraceMs = boundedDuration(options.childExitGraceMs, DEFAULT_CHILD_EXIT_GRACE_MS);
  const observation = normalizeObservation(input, observedAt);

  if (observation.errors.length > 0) {
    return result("UNKNOWN", "invalid-evidence", observedAt, null, observation.errors.map((code) => ({ code })));
  }

  const activeIdleMs = observation.activeIdleMs ?? null;
  const validPid = observation.pid !== null;
  const waitIsCurrent = observation.waitActive === true
    && (observation.waitUntil === null || observation.waitUntil > observedAt);
  if (waitIsCurrent) {
    const code = observation.waitKind === "approval" ? "approval-wait-active" : "declared-wait-active";
    return result("WORKING", code, observedAt, activeIdleMs, [{ code, activeIdleMs }]);
  }
  if (validPid && observation.processState === "exited") {
    return result("DEAD", "process-exited", observedAt, activeIdleMs, [{ code: "process-exited" }]);
  }
  if (validPid && observation.childState === "running") {
    return result("WORKING", "child-running", observedAt, activeIdleMs, [{ code: "child-running" }]);
  }
  if (validPid && observation.processState === "running" && ((observation.cpuDeltaMs ?? 0) > 0 || (observation.ioDeltaBytes ?? 0) > 0)) {
    return result("WORKING", "resource-movement", observedAt, activeIdleMs, [
      { code: "resource-movement", cpuDeltaMs: observation.cpuDeltaMs, ioDeltaBytes: observation.ioDeltaBytes },
    ]);
  }
  if (validPid && observation.socketMoving === true) {
    return result("WORKING", "socket-movement", observedAt, activeIdleMs, [{ code: "socket-movement" }]);
  }
  if (validPid && observation.processState === "running" && observation.stdinWaiting === true) {
    return result("STUCK_INPUT", "stdin-wait", observedAt, activeIdleMs, [{ code: "stdin-wait" }]);
  }
  if (validPid && observation.socketEstablished === true) {
    return result("UNKNOWN", "socket-wait", observedAt, activeIdleMs, [{ code: "socket-wait", activeIdleMs }]);
  }
  if (validPid && observation.childState === "exited") {
    if (observation.childExitedAt === null) {
      return result("UNKNOWN", "child-exit-time-unknown", observedAt, activeIdleMs, [{ code: "child-exit-time-unknown" }]);
    }
    const ageMs = observedAt - observation.childExitedAt;
    if (ageMs < childExitGraceMs) {
      return result("UNKNOWN", "child-exit-grace", observedAt, activeIdleMs, [
        { code: "child-exit-grace", ageMs, graceRemainingMs: childExitGraceMs - ageMs },
      ]);
    }
    return result("DEAD", "child-exited", observedAt, activeIdleMs, [{ code: "child-exited", ageMs }]);
  }
  if (activeIdleMs !== null && activeIdleMs < stallAfterMs) {
    return result("WORKING", "recent-progress", observedAt, activeIdleMs, [{ code: "recent-progress", activeIdleMs }]);
  }
  if (
    validPid
    && observation.processState === "running"
    && observation.childState === "none"
    && observation.socketEstablished === false
    && activeIdleMs !== null
    && activeIdleMs >= stallAfterMs
  ) {
    return result("DEAD", "stale-flat-process", observedAt, activeIdleMs, [{ code: "stale-flat-process", activeIdleMs }]);
  }
  const code = validPid ? "insufficient-evidence" : "missing-pid";
  return result("UNKNOWN", code, observedAt, activeIdleMs, [{ code, activeIdleMs }]);
}

/** @param {unknown} base @param {unknown} patch */
function mergeObservation(base, patch) {
  const left = record(base);
  const right = record(patch);
  const merged = { ...left, ...right };
  for (const key of NESTED_OBSERVATION_KEYS) {
    if (key in left || key in right) merged[key] = { ...record(left[key]), ...record(right[key]) };
  }
  return merged;
}

/** @param {unknown} patch */
function hasObservationField(patch) {
  if (!isRecord(patch)) return false;
  const value = record(patch);
  return NESTED_OBSERVATION_KEYS.some((key) => key in value);
}

/**
 * @param {string} name
 * @param {(context: {now: number, observation: unknown}) => Promise<unknown> | unknown} probe
 * @param {{now: number, observation: unknown}} context
 * @param {number} timeoutMs
 * @param {{setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout}} options
 */
async function runProbe(name, probe, context, timeoutMs, options) {
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimer(() => resolve({ status: "timeout", name }), timeoutMs);
    timer?.unref?.();
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => probe(context)).then(
        (value) => ({ status: hasObservationField(value) ? "ok" : "invalid", name, value }),
        () => ({ status: "error", name }),
      ),
      timeout,
    ]);
  } finally {
    if (timer !== undefined) clearTimer(timer);
  }
}

/**
 * Run caller-injected probes under a deadline and classify their combined,
 * sanitized observation. No OS APIs are used by this module.
 *
 * @param {unknown} input
 * @param {{
 *   now?: number | (() => number),
 *   probes?: Partial<Record<"process" | "child" | "wait" | "stdin" | "socket" | "activity", (context: {now: number, observation: unknown}) => Promise<unknown> | unknown>>,
 *   probeTimeoutMs?: number,
 *   stallAfterMs?: number,
 *   childExitGraceMs?: number,
 *   setTimer?: typeof setTimeout,
 *   clearTimer?: typeof clearTimeout,
 * }} [options]
 */
export async function evaluateLiveness(input, options = {}) {
  const observedAt = resolveNow(options.now);
  if (observedAt === null) return result("UNKNOWN", "invalid-clock", 0, null, [{ code: "invalid-clock" }]);
  const probes = record(options.probes);
  const timeoutMs = boundedDuration(options.probeTimeoutMs, DEFAULT_PROBE_TIMEOUT_MS);
  const outcomes = await Promise.all(PROBE_NAMES.flatMap((name) => {
    const probe = probes[name];
    return typeof probe === "function"
      ? [runProbe(
          name,
          /** @type {(context: {now: number, observation: unknown}) => Promise<unknown> | unknown} */ (probe),
          { now: observedAt, observation: input },
          timeoutMs,
          options,
        )]
      : [];
  }));
  const failures = outcomes.filter((outcome) => outcome.status !== "ok");
  if (failures.length > 0) {
    return result("UNKNOWN", "probe-failure", observedAt, null, failures.map((failure) => ({
      code: `probe-${failure.status}`,
      probe: failure.name,
    })));
  }
  let merged = input;
  for (const outcome of outcomes) merged = mergeObservation(merged, outcome.value);
  return classifyLiveness(merged, {
    now: observedAt,
    stallAfterMs: options.stallAfterMs,
    childExitGraceMs: options.childExitGraceMs,
  });
}

export const LIVENESS_DEFAULTS = Object.freeze({
  stallAfterMs: DEFAULT_STALL_AFTER_MS,
  childExitGraceMs: DEFAULT_CHILD_EXIT_GRACE_MS,
  probeTimeoutMs: DEFAULT_PROBE_TIMEOUT_MS,
  maxEvidenceItems: MAX_EVIDENCE_ITEMS,
});
