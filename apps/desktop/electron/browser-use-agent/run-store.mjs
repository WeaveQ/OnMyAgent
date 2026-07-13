import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const NON_TERMINAL_STATUSES = new Set(["running", "pending_approval"]);
const BLOCKED_KEY = /(authorization|broker.*token|cdp|credential|dom|environment|history|memory|model.*token|screenshot|secret|thinking|token)/i;

function safeValue(value, key = "") {
  if (BLOCKED_KEY.test(key)) return undefined;
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 4_000);
  if (Array.isArray(value)) {
    return value.map((item) => safeValue(item)).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return undefined;
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const safeChild = safeValue(childValue, childKey);
    if (safeChild !== undefined) result[childKey] = safeChild;
  }
  return result;
}

function deduplicateEvents(events) {
  const result = [];
  const ids = new Set();
  for (const rawEvent of Array.isArray(events) ? events : []) {
    const event = safeValue(rawEvent);
    if (!event || typeof event !== "object") continue;
    const id = String(event.id ?? "").trim();
    if (!id || ids.has(id)) continue;
    ids.add(id);
    result.push({ ...event, id });
  }
  return result;
}

function boundEvents(events, maxEventsPerRun, runId) {
  if (events.length <= maxEventsPerRun) return events;
  if (maxEventsPerRun === 1) return [events.at(-1)];
  if (maxEventsPerRun === 2) return [events[0], events.at(-1)];
  const tailCount = maxEventsPerRun - 2;
  return [
    events[0],
    {
      id: `${runId}:truncated`,
      type: "truncated",
      omittedCount: events.length - tailCount - 1,
    },
    ...events.slice(-tailCount),
  ];
}

function normalizeRun(rawRun, maxEventsPerRun, now) {
  if (!rawRun || typeof rawRun !== "object") return null;
  const runId = String(rawRun.runId ?? "").trim();
  const sessionId = String(rawRun.sessionId ?? "").trim();
  if (!runId || !sessionId) return null;
  const createdAt = Number(rawRun.createdAt) || now();
  const updatedAt = Number(rawRun.updatedAt) || createdAt;
  const events = boundEvents(deduplicateEvents(rawRun.events), maxEventsPerRun, runId);
  const normalized = {
    runId,
    sessionId,
    userMessageId: String(rawRun.userMessageId ?? "").trim() || null,
    ownerId: String(rawRun.ownerId ?? "").trim(),
    status: String(rawRun.status ?? "failed").trim() || "failed",
    createdAt,
    updatedAt,
    pendingApprovals: safeValue(Array.isArray(rawRun.pendingApprovals) ? rawRun.pendingApprovals : []),
    events,
  };
  const result = safeValue(rawRun.result, "result");
  const error = safeValue(rawRun.error, "error");
  if (result !== undefined) normalized.result = result;
  if (error !== undefined) normalized.error = error;
  return normalized;
}

function readState(filePath, maxEventsPerRun, now) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    const runs = Array.isArray(parsed?.runs)
      ? parsed.runs.map((run) => normalizeRun(run, maxEventsPerRun, now)).filter(Boolean)
      : [];
    return { version: 1, runs };
  } catch {
    return { version: 1, runs: [] };
  }
}

function writeState(filePath, state) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, filePath);
}

export function createBrowserUseRunStore({
  filePath,
  maxRuns = 100,
  maxEventsPerRun = 300,
  now = Date.now,
}) {
  if (!String(filePath ?? "").trim()) throw new Error("Browser Use run store filePath is required");
  let state = readState(filePath, maxEventsPerRun, now);

  const interruptedAt = now();
  let recovered = false;
  state.runs = state.runs.map((run) => {
    if (!NON_TERMINAL_STATUSES.has(run.status)) return run;
    recovered = true;
    const maxSequence = run.events.reduce(
      (value, event) => Math.max(value, Number(event.sequence) || 0),
      0,
    );
    return {
      ...run,
      status: "interrupted",
      error: "interrupted",
      updatedAt: interruptedAt,
      pendingApprovals: [],
      events: boundEvents(deduplicateEvents([
        ...run.events,
        {
          id: `${run.runId}:interrupted`,
          type: "error",
          sequence: maxSequence + 1,
          timestamp: interruptedAt,
          error: "",
          errorCode: "interrupted",
        },
      ]), maxEventsPerRun, run.runId),
    };
  });
  if (recovered) writeState(filePath, state);

  function saveRun(rawRun) {
    const run = normalizeRun(rawRun, maxEventsPerRun, now);
    if (!run) throw new Error("Browser Use runId and sessionId are required");
    const currentIndex = state.runs.findIndex((item) => item.runId === run.runId);
    if (currentIndex >= 0) state.runs[currentIndex] = run;
    else state.runs.push(run);
    state.runs = state.runs
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .slice(-maxRuns);
    writeState(filePath, state);
    return run;
  }

  function listBySession(sessionId) {
    const id = String(sessionId ?? "").trim();
    return state.runs
      .filter((run) => run.sessionId === id)
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((run) => structuredClone(run));
  }

  function getRun(runId) {
    const run = state.runs.find((item) => item.runId === runId);
    return run ? structuredClone(run) : null;
  }

  function deleteSession(sessionId) {
    const id = String(sessionId ?? "").trim();
    const nextRuns = state.runs.filter((run) => run.sessionId !== id);
    if (nextRuns.length === state.runs.length) return false;
    state = { ...state, runs: nextRuns };
    writeState(filePath, state);
    return true;
  }

  return { deleteSession, getRun, listBySession, saveRun };
}
