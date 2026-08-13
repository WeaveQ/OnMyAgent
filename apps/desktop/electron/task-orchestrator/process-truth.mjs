// @ts-check

const ACTIVE_STATES = new Set(["starting", "running", "stopping"]);
const UNCERTAIN_STATES = new Set(["cancelled", "canceled", "missing", "unknown"]);
const TERMINAL_STATES = new Set(["exited", "failed", "stopped", "terminated", "tombstoned", "stale"]);

function normalized(value) {
  return String(value ?? "").trim().toLowerCase().replaceAll("_", "-");
}

/**
 * Project process truth without mistaking cancellation/liveness uncertainty
 * for a confirmed child exit.  `terminationConfirmed` must be explicit (or
 * supplied by an exit observation with a valid exit code) before an exited
 * tombstone is allowed.
 */
export function classifyProcessTruth(input = {}) {
  const requested = normalized(input.status ?? input.processState ?? input.state);
  const childState = normalized(input.childState ?? input.child?.state);
  const exitCode = input.exitCode;
  const hasExitCode = exitCode !== null && exitCode !== undefined && exitCode !== ""
    && Number.isInteger(Number(exitCode));
  const terminationConfirmed = input.terminationConfirmed === true
    || input.exitConfirmed === true
    || (childState === "exited" && (input.childExitConfirmed === true || hasExitCode));
  if (terminationConfirmed) return {
    status: "exited",
    tombstone: true,
    confirmed: true,
    reason: "confirmed-termination",
  };
  if (UNCERTAIN_STATES.has(requested) || UNCERTAIN_STATES.has(childState)) return {
    status: requested || childState || "unknown",
    tombstone: false,
    confirmed: false,
    reason: "termination-unconfirmed",
  };
  if (TERMINAL_STATES.has(requested)) return {
    status: requested,
    tombstone: false,
    confirmed: false,
    reason: "terminal-status-unconfirmed",
  };
  return {
    status: ACTIVE_STATES.has(requested) ? requested : "unknown",
    tombstone: false,
    confirmed: false,
    reason: ACTIVE_STATES.has(requested) ? "active" : "truth-unknown",
  };
}

/** Keep every provider/process row, including independent checker attempts. */
export function includeProcessTruthRows(rows) {
  return Array.isArray(rows) ? rows.filter((row) => row && typeof row === "object" && !Array.isArray(row)) : [];
}

export const projectProcessTruth = classifyProcessTruth;
