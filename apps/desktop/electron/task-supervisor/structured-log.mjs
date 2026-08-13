import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { redactSensitiveText } from "../task-orchestrator/durable-redaction.mjs";

const MAX_LOG_BYTES = 2 * 1024 * 1024;

function safeError(error) {
  return {
    code: redactSensitiveText(String(error?.code ?? error?.name ?? "Error"), 120),
    message: redactSensitiveText(error instanceof Error ? error.message : String(error ?? "Unknown error"), 1_000),
  };
}

export function supervisorLogPaths(userDataDir) {
  const root = path.join(path.resolve(String(userDataDir)), "runtime-state", "task-center-supervisor");
  return {
    root,
    logPath: path.join(root, "supervisor.jsonl"),
    priorLogPath: path.join(root, "supervisor.previous.jsonl"),
    lastCrashPath: path.join(root, "last-crash.json"),
  };
}

export function createTaskSupervisorStructuredLog(options = {}) {
  const paths = supervisorLogPaths(options.userDataDir);
  const now = typeof options.now === "function" ? options.now : Date.now;
  let queue = Promise.resolve();

  async function rotateIfNeeded() {
    const info = await stat(paths.logPath).catch(() => null);
    if (!info || info.size < MAX_LOG_BYTES) return;
    await rename(paths.logPath, paths.priorLogPath).catch(() => undefined);
  }

  function write(level, type, data = {}) {
    const record = {
      at: now(),
      level: String(level).slice(0, 20),
      type: String(type).slice(0, 120),
      pid: process.pid,
      data: Object.fromEntries(Object.entries(data).slice(0, 30).map(([key, value]) => [
        String(key).slice(0, 80),
        typeof value === "number" || typeof value === "boolean" || value === null
          ? value
          : redactSensitiveText(value, 1_000),
      ])),
    };
    queue = queue.catch(() => undefined).then(async () => {
      await mkdir(paths.root, { recursive: true, mode: 0o700 });
      await rotateIfNeeded();
      await appendFile(paths.logPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    });
    return queue;
  }

  async function recordCrash(error, extra = {}) {
    const safeExtra = Object.fromEntries(Object.entries(extra).slice(0, 20).map(([key, value]) => [
      String(key).slice(0, 80),
      typeof value === "number" || typeof value === "boolean" || value === null
        ? value
        : redactSensitiveText(value, 500),
    ]));
    const record = { at: now(), pid: process.pid, error: safeError(error), extra: safeExtra };
    await mkdir(paths.root, { recursive: true, mode: 0o700 });
    await writeFile(paths.lastCrashPath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
    await write("error", "supervisor-crash", { ...safeExtra, ...record.error });
    return record;
  }

  async function lastCrash() {
    try { return JSON.parse(await readFile(paths.lastCrashPath, "utf8")); } catch { return null; }
  }

  return Object.freeze({
    paths,
    write,
    recordCrash,
    lastCrash,
    flush: () => queue,
  });
}
