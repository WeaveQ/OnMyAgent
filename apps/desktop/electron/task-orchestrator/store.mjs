import { randomBytes } from "node:crypto";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import {
  taskOrchestratorEventSchema,
  taskOrchestratorHandoffArtifactSchema,
  taskOrchestratorHumanGateSchema,
  taskOrchestratorLegacyTaskSchema,
  taskOrchestratorRunSchema,
  taskOrchestratorSnapshotSchema,
  taskOrchestratorTaskListResultSchema,
  taskOrchestratorTaskSchema,
  taskOrchestratorTaskSummarySchema,
} from "@onmyagent/types/task-orchestrator";

import {
  sanitizeArtifact,
  sanitizeEvent,
  sanitizeGate,
  sanitizeRun,
  sanitizeTask,
} from "./store-sanitization.mjs";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const SNAPSHOT_EVENT_LIMIT = 1_000;

function requireSafeId(value, label) {
  const id = String(value ?? "").trim();
  if (!id || id.length > 120 || !SAFE_ID.test(id)) {
    throw new Error(`${label} is invalid`);
  }
  return id;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function readJson(targetPath, schema, label) {
  let raw;
  try {
    raw = await readFile(targetPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} contains invalid JSON: ${errorMessage(error)}`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${label} failed schema validation: ${parsed.error.message}`);
  }
  return parsed.data;
}

async function writeAtomic(targetPath, content) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(temporaryPath, content, "utf8");
  const attempts = process.platform === "win32" ? 12 : 3;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(temporaryPath, targetPath);
      return;
    } catch (error) {
      lastError = error;
      if (!new Set(["EPERM", "EACCES", "EBUSY", "EEXIST"]).has(error?.code) || attempt === attempts - 1) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 8 * (attempt + 1)));
    }
  }
  await rm(temporaryPath, { force: true }).catch(() => undefined);
  throw lastError;
}

async function writeJsonAtomic(targetPath, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  JSON.parse(content);
  await writeAtomic(targetPath, content);
}

async function directoryNames(targetPath) {
  try {
    const entries = await readdir(targetPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export function createTaskOrchestratorStore(options = {}) {
  const userDataDir = String(options.userDataDir ?? "").trim();
  if (!userDataDir) throw new Error("userDataDir is required");

  const rootDirectory = path.join(userDataDir, "runtime-state", "task-center");
  const tasksDirectory = path.join(rootDirectory, "tasks");

  function taskDirectory(taskId) {
    return path.join(tasksDirectory, requireSafeId(taskId, "taskId"));
  }

  function runDirectory(taskId, taskRunId) {
    return path.join(
      taskDirectory(taskId),
      "runs",
      requireSafeId(taskRunId, "taskRunId"),
    );
  }

  async function initialize() {
    await mkdir(tasksDirectory, { recursive: true });
  }

  async function readTask(taskId) {
    const id = requireSafeId(taskId, "taskId");
    const targetPath = path.join(taskDirectory(id), "task.json");
    let raw;
    try {
      raw = JSON.parse(await readFile(targetPath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      if (error instanceof SyntaxError) throw new Error(`task ${id} contains invalid JSON: ${error.message}`);
      throw error;
    }
    const parsed = taskOrchestratorTaskSchema.safeParse(raw);
    if (parsed.success) return taskOrchestratorTaskSchema.parse(sanitizeTask(parsed.data));
    if (taskOrchestratorLegacyTaskSchema.safeParse(raw).success) {
      throw new Error(`Task ${id} is legacy Task Center v1 state and is read-only; migrate it explicitly before using Task Center v2`);
    }
    throw new Error(`task ${id} failed schema validation: ${parsed.error.message}`);
  }

  async function isLegacyTask(taskId) {
    const id = requireSafeId(taskId, "taskId");
    const targetPath = path.join(taskDirectory(id), "task.json");
    let raw;
    try {
      raw = JSON.parse(await readFile(targetPath, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      if (error instanceof SyntaxError) throw new Error(`task ${id} contains invalid JSON: ${error.message}`);
      throw error;
    }
    return taskOrchestratorLegacyTaskSchema.safeParse(raw).success;
  }

  async function requireTask(taskId) {
    const task = await readTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  async function writeTask(task) {
    const parsed = taskOrchestratorTaskSchema.parse(sanitizeTask(task));
    await writeJsonAtomic(path.join(taskDirectory(parsed.id), "task.json"), parsed);
    return parsed;
  }

  async function readRun(taskId, taskRunId) {
    const id = requireSafeId(taskRunId, "taskRunId");
    const run = await readJson(
      path.join(runDirectory(taskId, id), "run.json"),
      taskOrchestratorRunSchema,
      `run ${id}`,
    );
    return run ? taskOrchestratorRunSchema.parse(sanitizeRun(run)) : null;
  }

  async function requireRun(taskId, taskRunId) {
    const run = await readRun(taskId, taskRunId);
    if (!run) throw new Error(`Run not found: ${taskRunId}`);
    return run;
  }

  async function writeRun(run) {
    const parsed = taskOrchestratorRunSchema.parse(sanitizeRun(run));
    await writeJsonAtomic(path.join(runDirectory(parsed.taskId, parsed.id), "run.json"), parsed);
    return parsed;
  }

  function newestRunFirst(left, right) {
    if (left.createdAt !== right.createdAt) return right.createdAt - left.createdAt;
    if (left.id === right.id) return 0;
    return left.id < right.id ? 1 : -1;
  }

  async function runsForTask(taskId) {
    const id = requireSafeId(taskId, "taskId");
    const runs = [];
    const base = path.join(taskDirectory(id), "runs");
    for (const taskRunId of await directoryNames(base)) {
      const run = await readRun(id, taskRunId);
      if (run) runs.push(run);
    }
    // Creation time is the durable ordering key; an id-descending tie-break
    // keeps recovery deterministic when an injected clock returns equal values.
    return runs.sort(newestRunFirst);
  }

  async function reconcileLatestRunPointer(taskId) {
    const task = await requireTask(taskId);
    const runs = await runsForTask(task.id);
    const latestRun = runs[0] ?? null;
    const latestRunId = latestRun?.id ?? null;
    if (task.latestRunId === latestRunId) return { task, runs, changed: false };
    const repairedTask = { ...task, latestRunId };
    // Recovery changes only the derived pointer. Definition fields, revision,
    // and updatedAt remain exactly as persisted by the last user mutation.
    await writeTask(repairedTask);
    return { task: repairedTask, runs, changed: true };
  }

  async function reconcileLatestRunPointers() {
    const reconciled = [];
    for (const taskId of await directoryNames(tasksDirectory)) {
      if (await isLegacyTask(taskId)) continue;
      reconciled.push(await reconcileLatestRunPointer(taskId));
    }
    return reconciled;
  }

  async function readEvents(taskId, taskRunId) {
    const targetPath = taskRunId
      ? path.join(runDirectory(taskId, taskRunId), "events.jsonl")
      : path.join(taskDirectory(taskId), "alignment-events.jsonl");
    let raw;
    try {
      raw = await readFile(targetPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    const events = [];
    const lines = raw.split("\n");
    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      let value;
      try {
        value = JSON.parse(line);
      } catch (error) {
        // A process crash can interrupt only the final append. Ignore that
        // unterminated tail; a malformed completed line remains a hard error.
        if (index === lines.length - 1 && !raw.endsWith("\n")) continue;
        throw new Error(`event line ${index + 1} is invalid JSON: ${errorMessage(error)}`);
      }
      const parsed = taskOrchestratorEventSchema.safeParse(value);
      if (!parsed.success) {
        throw new Error(`event line ${index + 1} failed schema validation: ${parsed.error.message}`);
      }
      events.push(taskOrchestratorEventSchema.parse(sanitizeEvent(parsed.data)));
    }
    return events;
  }

  async function appendEvent(event) {
    const parsed = taskOrchestratorEventSchema.parse(sanitizeEvent(event));
    const targetPath = parsed.taskRunId
      ? path.join(runDirectory(parsed.taskId, parsed.taskRunId), "events.jsonl")
      : path.join(taskDirectory(parsed.taskId), "alignment-events.jsonl");
    await mkdir(path.dirname(targetPath), { recursive: true });
    try {
      const existing = await readFile(targetPath, "utf8");
      if (existing && !existing.endsWith("\n")) {
        const lastCompleteLine = existing.lastIndexOf("\n");
        await writeAtomic(targetPath, lastCompleteLine < 0 ? "" : existing.slice(0, lastCompleteLine + 1));
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await appendFile(targetPath, `${JSON.stringify(parsed)}\n`, "utf8");
    return parsed;
  }

  async function nextEventSequence(taskId, taskRunId) {
    const events = await readEvents(taskId, taskRunId);
    return (events.at(-1)?.sequence ?? 0) + 1;
  }

  async function writeArtifact(artifact) {
    const parsed = taskOrchestratorHandoffArtifactSchema.parse(sanitizeArtifact(artifact));
    const artifactDirectory = path.join(
      runDirectory(parsed.taskId, parsed.taskRunId),
      "artifacts",
      parsed.id,
    );
    const { content, ...metadata } = parsed;
    try {
      await access(path.join(artifactDirectory, "metadata.json"));
      throw new Error(`Artifact already exists and is immutable: ${parsed.id}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    // Content is written first; metadata is the commit marker for an immutable artifact.
    await writeAtomic(path.join(artifactDirectory, "content.txt"), content);
    await writeJsonAtomic(path.join(artifactDirectory, "metadata.json"), metadata);
    return parsed;
  }

  async function readArtifacts(taskId, taskRunId) {
    const base = path.join(runDirectory(taskId, taskRunId), "artifacts");
    const artifacts = [];
    for (const artifactId of await directoryNames(base)) {
      requireSafeId(artifactId, "artifactId");
      const metadataPath = path.join(base, artifactId, "metadata.json");
      const contentPath = path.join(base, artifactId, "content.txt");
      let metadata;
      let content;
      try {
        metadata = JSON.parse(await readFile(metadataPath, "utf8"));
        content = await readFile(contentPath, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw new Error(`artifact ${artifactId} could not be read: ${errorMessage(error)}`);
      }
      artifacts.push(taskOrchestratorHandoffArtifactSchema.parse(sanitizeArtifact({
        ...metadata,
        content,
      })));
    }
    return artifacts.sort((left, right) => left.createdAt - right.createdAt);
  }

  async function latestArtifactCreatedAt(taskId, taskRunId) {
    return (await readArtifacts(taskId, taskRunId)).at(-1)?.createdAt ?? null;
  }

  async function writeGate(gate) {
    const parsed = taskOrchestratorHumanGateSchema.parse(sanitizeGate(gate));
    const targetPath = path.join(
      runDirectory(parsed.taskId, parsed.taskRunId),
      "gates",
      `${parsed.id}.json`,
    );
    await writeJsonAtomic(targetPath, parsed);
    return parsed;
  }

  async function readGates(taskId, taskRunId) {
    const base = path.join(runDirectory(taskId, taskRunId), "gates");
    const gates = [];
    let entries;
    try {
      entries = await readdir(base, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const id = entry.name.slice(0, -5);
      requireSafeId(id, "gateId");
      const gate = await readJson(path.join(base, entry.name), taskOrchestratorHumanGateSchema, `gate ${id}`);
      if (gate) gates.push(taskOrchestratorHumanGateSchema.parse(sanitizeGate(gate)));
    }
    return gates.sort((left, right) => left.requestedAt - right.requestedAt);
  }

  async function snapshot(taskId, requestedRunId) {
    const task = await requireTask(taskId);
    const taskRunId = requestedRunId ?? task.latestRunId;
    const run = taskRunId ? await requireRun(task.id, taskRunId) : null;
    const artifacts = run ? await readArtifacts(task.id, run.id) : [];
    const events = run
      ? (await readEvents(task.id, run.id)).slice(-SNAPSHOT_EVENT_LIMIT)
      : (await readEvents(task.id, null)).slice(-SNAPSHOT_EVENT_LIMIT);
    const gates = run ? await readGates(task.id, run.id) : [];
    return taskOrchestratorSnapshotSchema.parse({ task, run, artifacts, events, gates });
  }

  async function listTasks(input = {}) {
    const workspaceRoot = String(input.workspaceRoot ?? "").trim();
    const limit = Math.min(200, Math.max(1, Number(input.limit) || 100));
    const tasks = [];
    const issues = [];
    for (const taskId of await directoryNames(tasksDirectory)) {
      try {
        if (await isLegacyTask(taskId)) continue;
        const task = await requireTask(taskId);
        if (workspaceRoot && task.workspaceRoot !== workspaceRoot) continue;
        let latestRun = null;
        if (task.latestRunId) latestRun = await requireRun(task.id, task.latestRunId);
        const currentAttempt = latestRun?.currentAttemptId
          ? [...latestRun.primaryAttempts, ...latestRun.workerAttempts].find((attempt) => attempt.id === latestRun.currentAttemptId)
          : null;
        tasks.push(taskOrchestratorTaskSummarySchema.parse({
          id: task.id,
          revision: task.revision,
          idea: task.idea,
          workspaceRoot: task.workspaceRoot,
          definitionStatus: task.definitionStatus,
          latestRunId: task.latestRunId,
          latestRunStatus: latestRun?.status ?? null,
          permissionMode: task.permissionMode,
          contractFinalization: task.contractFinalization,
          currentActor: currentAttempt?.kind ?? null,
          updatedAt: task.updatedAt,
        }));
      } catch (error) {
        issues.push(`${taskId}: ${errorMessage(error)}`);
      }
    }
    tasks.sort((left, right) => right.updatedAt - left.updatedAt);
    let offset = 0;
    if (input.cursor != null) {
      try {
        const parsed = JSON.parse(Buffer.from(String(input.cursor), "base64url").toString("utf8"));
        if (!Number.isInteger(parsed) || parsed < 0) throw new Error();
        offset = parsed;
      } catch { throw new Error("task list cursor is invalid"); }
    }
    const page = tasks.slice(offset, offset + limit);
    const hasMore = offset + page.length < tasks.length;
    return taskOrchestratorTaskListResultSchema.parse({
      tasks: page,
      issues,
      nextCursor: hasMore ? Buffer.from(JSON.stringify(offset + page.length), "utf8").toString("base64url") : null,
      hasMore,
    });
  }

  async function findRun(taskRunId) {
    const id = requireSafeId(taskRunId, "taskRunId");
    for (const taskId of await directoryNames(tasksDirectory)) {
      if (await isLegacyTask(taskId)) continue;
      const run = await readRun(taskId, id);
      if (run) return { taskId, run };
    }
    return null;
  }

  async function allRuns() {
    const found = [];
    for (const taskId of await directoryNames(tasksDirectory)) {
      if (await isLegacyTask(taskId)) continue;
      found.push(...await runsForTask(taskId));
    }
    return found;
  }

  return {
    rootDirectory,
    initialize,
    readTask,
    requireTask,
    writeTask,
    readRun,
    requireRun,
    writeRun,
    runsForTask,
    reconcileLatestRunPointer,
    reconcileLatestRunPointers,
    readEvents,
    appendEvent,
    nextEventSequence,
    writeArtifact,
    readArtifacts,
    latestArtifactCreatedAt,
    writeGate,
    readGates,
    snapshot,
    listTasks,
    findRun,
    allRuns,
  };
}
