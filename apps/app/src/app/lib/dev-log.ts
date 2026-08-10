export type DevLogLevel = "debug" | "info" | "warn" | "error" | "perf";

export type DevLogRecord = {
  id: number;
  at: string;
  ts: number;
  level: DevLogLevel;
  source: string;
  label: string;
  payload?: unknown;
};

type DevRoot = typeof globalThis & {
  __onmyagentDevLogSeq?: number;
  __onmyagentDevLogs?: DevLogRecord[];
};

const DEV_LOG_LIMIT = 1500;

const payloadText = (value: unknown) => {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

export type DevLogInput = {
  level: DevLogLevel;
  source: string;
  label: string;
  payload?: unknown;
};

/**
 * Single structured logger entry for renderer diagnostics.
 * Prefer this (or createDevLogger) over ad-hoc console.* for new paths.
 */
export const recordDevLog = (
  enabled: boolean,
  input: DevLogInput,
): DevLogRecord | undefined => {
  if (!enabled) return undefined;

  const root = globalThis as DevRoot;
  const id = (root.__onmyagentDevLogSeq ?? 0) + 1;
  root.__onmyagentDevLogSeq = id;

  const entry: DevLogRecord = {
    id,
    at: new Date().toISOString(),
    ts: Date.now(),
    level: input.level,
    source: input.source,
    label: input.label,
    payload: input.payload,
  };

  const logs = root.__onmyagentDevLogs ?? [];
  logs.push(entry);
  if (logs.length > DEV_LOG_LIMIT) {
    logs.splice(0, logs.length - DEV_LOG_LIMIT);
  }
  root.__onmyagentDevLogs = logs;
  return entry;
};

/** Bound logger for a fixed source/label surface (levels + optional enable flag). */
export function createDevLogger(
  source: string,
  options: { enabled?: boolean } = {},
) {
  const enabled = () => options.enabled !== false;
  const write = (level: DevLogLevel, label: string, payload?: unknown) =>
    recordDevLog(enabled(), { level, source, label, payload });
  return {
    source,
    debug: (label: string, payload?: unknown) => write("debug", label, payload),
    info: (label: string, payload?: unknown) => write("info", label, payload),
    warn: (label: string, payload?: unknown) => write("warn", label, payload),
    error: (label: string, payload?: unknown) => write("error", label, payload),
    perf: (label: string, payload?: unknown) => write("perf", label, payload),
  };
}

export const readDevLogs = (limit = 200) => {
  const root = globalThis as DevRoot;
  const logs = root.__onmyagentDevLogs ?? [];
  if (limit === 0) return logs.slice();
  if (limit < 0) return [];
  if (logs.length <= limit) return logs.slice();
  return logs.slice(logs.length - limit);
};

export const clearDevLogs = () => {
  const root = globalThis as DevRoot;
  root.__onmyagentDevLogs = [];
  root.__onmyagentDevLogSeq = 0;
};

export const formatDevLogLine = (entry: DevLogRecord) => {
  const prefix = `[${entry.at}] ${entry.level.toUpperCase()} ${entry.source}:${entry.label}`;
  const text = payloadText(entry.payload);
  return text ? `${prefix} ${text}` : prefix;
};

export const formatDevLogText = (limit = 200) => {
  const lines = readDevLogs(limit).map(formatDevLogLine);
  if (!lines.length) return "";
  return `${lines.join("\n")}\n`;
};
