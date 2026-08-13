// @ts-check

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "blocked", "cancelled"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeInteger(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function safePercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
    ? Math.round(parsed * 100) / 100
    : null;
}

/** Normalize only numeric/context labels; provider payloads never cross this boundary. */
export function normalizeContextUsage(value) {
  if (!isRecord(value)) return null;
  const usedTokens = safeInteger(value.usedTokens ?? value.used ?? value.inputTokens);
  const totalTokens = safeInteger(value.totalTokens ?? value.total);
  const explicitPercent = safePercent(value.percent ?? value.percentage);
  const percent = explicitPercent ?? (usedTokens !== null && totalTokens !== null && totalTokens > 0
    ? Math.min(100, Math.max(0, Math.round((usedTokens / totalTokens) * 10_000) / 100))
    : null);
  const modelId = typeof value.modelId === "string" && value.modelId.trim() ? value.modelId.trim().slice(0, 240) : null;
  const source = typeof value.source === "string" && value.source.trim()
    ? value.source.trim().slice(0, 40)
    : typeof value.totalSource === "string" && value.totalSource.trim() ? value.totalSource.trim().slice(0, 40) : "unknown";
  const observedAt = safeInteger(value.observedAt);
  if (usedTokens === null && totalTokens === null && percent === null && !modelId) return null;
  return { usedTokens, totalTokens, percent, source, modelId, observedAt };
}

/** Exclude wall-clock observations so identical usage does not emit duplicate progress. */
export function contextUsageSignature(value) {
  const usage = normalizeContextUsage(value);
  return usage === null ? null : JSON.stringify([
    usage.usedTokens,
    usage.totalTokens,
    usage.percent,
    usage.source,
    usage.modelId,
  ]);
}

export function isTerminalContextStatus(status) {
  return TERMINAL_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

/** Initialize the observer with the usage captured by the provider start event. */
export function createContextUsagePersistenceState(startedUsage = null) {
  const startedSignature = contextUsageSignature(startedUsage);
  return {
    startedSignature,
    lastSignature: startedSignature,
    lastStatus: "started",
  };
}

/**
 * Decide whether a context/usage observation may be persisted.  The caller
 * supplies the already lease-fenced result; an absent/false lease never
 * advances the observer state.  Missing status is treated as unknown and also
 * cannot advance progress.
 */
export function observeContextUsageForPersistence(input = {}) {
  const previous = isRecord(input.state)
    ? input.state
    : createContextUsagePersistenceState();
  const usage = normalizeContextUsage(input.usage ?? input.contextUsage ?? input.context);
  const rawStatus = input.status ?? (isRecord(input.snapshot) ? input.snapshot.status : null);
  const status = typeof rawStatus === "string" && rawStatus.trim() ? rawStatus.trim().toLowerCase() : null;
  const leaseCurrent = input.leaseCurrent === true;
  if (!leaseCurrent) return { persist: false, changed: false, terminal: false, reason: "lease-not-current", usage, state: previous };
  if (status === null) return { persist: false, changed: false, terminal: false, reason: "status-missing", usage, state: previous };
  if (usage === null) return { persist: false, changed: false, terminal: isTerminalContextStatus(status), reason: "usage-missing", usage, state: previous };
  const signature = contextUsageSignature(usage);
  const changed = signature !== previous.lastSignature;
  const terminal = isTerminalContextStatus(status);
  const persist = changed || terminal;
  const state = persist
    ? { ...previous, lastSignature: signature, lastStatus: status }
    : { ...previous, lastStatus: status };
  return { persist, changed, terminal, reason: persist ? (terminal ? "terminal" : "changed") : "unchanged", usage, state };
}

export const createContextUsagePersistence = createContextUsagePersistenceState;
export const projectContextUsagePersistence = observeContextUsageForPersistence;
