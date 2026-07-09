import type { CollaborationGoalRuntime, TodoItem } from "../../app/types";
import { deriveGoalSummary } from "./session-route-composer";

/**
 * Thin localStorage wrapper for the React shell's "remember what the user had
 * open" behavior. Keys mirror those the Solid app used so users don't lose
 * their spot when switching between shells during the port.
 */

const ACTIVE_WORKSPACE_KEY = "onmyagent.react.activeWorkspace";
const SESSION_BY_WORKSPACE_KEY = "onmyagent.react.sessionByWorkspace";
const WORKSPACE_ORDER_KEY = "onmyagent.react.workspaceOrder";
const GOAL_RUNTIME_BY_SESSION_KEY = "onmyagent.react.goalRuntimeBySession.v1";
const TODOS_BY_SESSION_KEY = "onmyagent.react.todosBySession.v1";

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null || value === "") {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(key, value);
  } catch {
    // ignore storage errors (quota, privacy modes, etc.)
  }
}

export function readActiveWorkspaceId(): string | null {
  const value = safeGet(ACTIVE_WORKSPACE_KEY);
  return value?.trim() || null;
}

export function writeActiveWorkspaceId(id: string | null): void {
  safeSet(ACTIVE_WORKSPACE_KEY, id?.trim() || null);
}

export function readWorkspaceOrderIds(): string[] {
  const raw = safeGet(WORKSPACE_ORDER_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      const trimmed = typeof value === "string" ? value.trim() : "";
      return trimmed ? [trimmed] : [];
    });
  } catch {
    return [];
  }
}

export function writeWorkspaceOrderIds(ids: string[]): void {
  const normalized = ids.flatMap((id) => {
    const trimmed = id.trim();
    return trimmed ? [trimmed] : [];
  });
  safeSet(WORKSPACE_ORDER_KEY, normalized.length ? JSON.stringify(normalized) : null);
}

type SessionByWorkspace = Record<string, string>;

function readSessionByWorkspaceMap(): SessionByWorkspace {
  const raw = safeGet(SESSION_BY_WORKSPACE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const result: SessionByWorkspace = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof key === "string" && typeof value === "string") {
          result[key] = value;
        }
      }
      return result;
    }
  } catch {
    // ignore malformed payload
  }
  return {};
}

export function readLastSessionFor(workspaceId: string): string | null {
  const id = workspaceId?.trim();
  if (!id) return null;
  return readSessionByWorkspaceMap()[id] ?? null;
}

export function writeLastSessionFor(workspaceId: string, sessionId: string | null): void {
  const wsId = workspaceId?.trim();
  if (!wsId) return;
  const map = readSessionByWorkspaceMap();
  const normalized = sessionId?.trim() || "";
  if (!normalized) {
    if (!(wsId in map)) return;
    delete map[wsId];
  } else {
    if (map[wsId] === normalized) return;
    map[wsId] = normalized;
  }
  safeSet(SESSION_BY_WORKSPACE_KEY, Object.keys(map).length ? JSON.stringify(map) : null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readStringArrayField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = typeof item === "string" ? item.trim() : "";
    return text ? [text] : [];
  });
}

function readNumberField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readGoalStatus(
  record: Record<string, unknown>,
): CollaborationGoalRuntime["status"] | null {
  const status = record.status;
  if (
    status === "running" ||
    status === "waiting" ||
    status === "paused" ||
    status === "completed"
  ) {
    return status;
  }
  return null;
}

function readGoalWaitingReason(
  record: Record<string, unknown>,
): CollaborationGoalRuntime["waitingReason"] | undefined {
  const reason = record.waitingReason;
  if (
    reason === "permission" ||
    reason === "question" ||
    reason === "compacting" ||
    reason === "tool" ||
    reason === "user" ||
    reason === "idle"
  ) {
    return reason;
  }
  return undefined;
}

function parseGoalRuntime(value: unknown): CollaborationGoalRuntime | null {
  if (!isRecord(value)) return null;
  if (value.source !== "goal_intent") return null;
  const status = readGoalStatus(value);
  const objective = readStringField(value, "objective").trim();
  const messageBaseline = readNumberField(value, "messageBaseline");
  const startedAt = readNumberField(value, "startedAt");
  const updatedAt = readNumberField(value, "updatedAt");
  const totalPausedMs = readNumberField(value, "totalPausedMs");
  if (
    !status ||
    !objective ||
    messageBaseline === undefined ||
    startedAt === undefined ||
    updatedAt === undefined ||
    totalPausedMs === undefined
  ) {
    return null;
  }
  const restoredStatus = status === "running" ? "waiting" : status;
  const runtime: CollaborationGoalRuntime = {
    source: "goal_intent",
    status: restoredStatus,
    objective,
    messageBaseline,
    startedAt,
    updatedAt,
    totalPausedMs,
  };
  if (restoredStatus === "waiting") {
    runtime.waitingReason = readGoalWaitingReason(value) ?? "idle";
  }
  const lastRunMessageBaseline = readNumberField(value, "lastRunMessageBaseline");
  if (lastRunMessageBaseline !== undefined) {
    runtime.lastRunMessageBaseline = lastRunMessageBaseline;
  }
  const pauseStartedAt = readNumberField(value, "pauseStartedAt");
  if (pauseStartedAt !== undefined && restoredStatus === "paused") {
    runtime.pauseStartedAt = pauseStartedAt;
  }
  const lastRunStartedAt = readNumberField(value, "lastRunStartedAt");
  if (lastRunStartedAt !== undefined) {
    runtime.lastRunStartedAt = lastRunStartedAt;
  }
  const completedAt = readNumberField(value, "completedAt");
  if (completedAt !== undefined && restoredStatus === "completed") {
    runtime.completedAt = completedAt;
  }
  const rawSummary = readStringField(value, "summary").trim();
  const summary = rawSummary ? deriveGoalSummary(rawSummary) : "";
  if (summary) runtime.summary = summary;
  const currentCheckpoint = readStringField(value, "currentCheckpoint").trim();
  if (currentCheckpoint) runtime.currentCheckpoint = currentCheckpoint;
  const completionCriteria = readStringArrayField(value, "completionCriteria");
  if (completionCriteria.length) runtime.completionCriteria = completionCriteria;
  const validationCommands = readStringArrayField(value, "validationCommands");
  if (validationCommands.length) runtime.validationCommands = validationCommands;
  const progressLog = readStringArrayField(value, "progressLog");
  if (progressLog.length) runtime.progressLog = progressLog;
  const lastKnownTodosValue = value.lastKnownTodos;
  if (Array.isArray(lastKnownTodosValue)) {
    const lastKnownTodos = lastKnownTodosValue.flatMap((item) => {
      const todo = parseTodoItem(item);
      return todo ? [todo] : [];
    });
    if (lastKnownTodos.length) runtime.lastKnownTodos = lastKnownTodos;
  }
  return runtime;
}

function parseTodoItem(value: unknown): TodoItem | null {
  if (!isRecord(value)) return null;
  const id = readStringField(value, "id").trim();
  const content = readStringField(value, "content").trim();
  const status = readStringField(value, "status").trim();
  const priority = readStringField(value, "priority").trim();
  if (!id || !content) return null;
  return {
    id,
    content,
    status: status || "pending",
    priority,
  };
}

export function readSessionGoalRuntimes(): Record<string, CollaborationGoalRuntime> {
  const raw = safeGet(GOAL_RUNTIME_BY_SESSION_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const result: Record<string, CollaborationGoalRuntime> = {};
    for (const [sessionId, value] of Object.entries(parsed)) {
      const normalizedSessionId = sessionId.trim();
      if (!normalizedSessionId) continue;
      const runtime = parseGoalRuntime(value);
      if (runtime) result[normalizedSessionId] = runtime;
    }
    return result;
  } catch {
    return {};
  }
}

export function writeSessionGoalRuntimes(
  runtimes: Record<string, CollaborationGoalRuntime>,
): void {
  const entries = Object.entries(runtimes).filter(
    ([sessionId, runtime]) => sessionId.trim() && runtime.objective.trim(),
  );
  if (!entries.length) {
    safeSet(GOAL_RUNTIME_BY_SESSION_KEY, null);
    return;
  }
  safeSet(GOAL_RUNTIME_BY_SESSION_KEY, JSON.stringify(Object.fromEntries(entries)));
}

export function readSessionTodos(): Record<string, TodoItem[]> {
  const raw = safeGet(TODOS_BY_SESSION_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const result: Record<string, TodoItem[]> = {};
    for (const [sessionId, value] of Object.entries(parsed)) {
      const normalizedSessionId = sessionId.trim();
      if (!normalizedSessionId || !Array.isArray(value)) continue;
      const todos = value.flatMap((item) => {
        const todo = parseTodoItem(item);
        return todo ? [todo] : [];
      });
      if (todos.length) result[normalizedSessionId] = todos;
    }
    return result;
  } catch {
    return {};
  }
}

export function writeSessionTodos(todosBySessionId: Record<string, TodoItem[]>): void {
  const entries = Object.entries(todosBySessionId).flatMap(([sessionId, todos]) => {
    const normalizedSessionId = sessionId.trim();
    const visibleTodos = todos.filter((todo) => todo.content.trim());
    return normalizedSessionId && visibleTodos.length
      ? [[normalizedSessionId, visibleTodos] as const]
      : [];
  });
  if (!entries.length) {
    safeSet(TODOS_BY_SESSION_KEY, null);
    return;
  }
  safeSet(TODOS_BY_SESSION_KEY, JSON.stringify(Object.fromEntries(entries)));
}

export function forgetWorkspaceMemory(workspaceId: string): void {
  const wsId = workspaceId?.trim();
  if (!wsId) return;
  const map = readSessionByWorkspaceMap();
  if (wsId in map) {
    delete map[wsId];
    safeSet(SESSION_BY_WORKSPACE_KEY, Object.keys(map).length ? JSON.stringify(map) : null);
  }
  const active = readActiveWorkspaceId();
  if (active === wsId) writeActiveWorkspaceId(null);
  const workspaceOrderIds = readWorkspaceOrderIds();
  if (workspaceOrderIds.includes(wsId)) {
    writeWorkspaceOrderIds(workspaceOrderIds.filter((id) => id !== wsId));
  }
}
