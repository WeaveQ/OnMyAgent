import { readFile } from "node:fs/promises";
import path from "node:path";

/** Same path Task Supervisor uses in `task-supervisor/service.mjs`. */
export const TASK_SUPERVISOR_PROCESS_REGISTRY_RELATIVE = path.join(
  "runtime-state",
  "task-center-supervisor",
  "personal-agent-process-registry.json",
);

const SUPERVISOR_NAMESPACES = new Set(["task-supervisor", "task-center-supervisor"]);

export function resolveTaskSupervisorRegistryFile(userDataDir) {
  const root = String(userDataDir ?? "").trim();
  if (!root) return null;
  return path.join(root, TASK_SUPERVISOR_PROCESS_REGISTRY_RELATIVE);
}

export function supervisorOwnedRunIdsFromRegistry(registry) {
  const ids = new Set();
  if (!registry || typeof registry !== "object") return ids;
  const namespace = String(registry.namespace ?? "").trim();
  if (namespace && !SUPERVISOR_NAMESPACES.has(namespace)) return ids;
  const processes = Array.isArray(registry.processes) ? registry.processes : [];
  for (const record of processes) {
    const runId = String(record?.runId ?? "").trim();
    if (runId) ids.add(runId);
  }
  return ids;
}

export function shouldFinalizeOrphanRunLog({
  runId,
  inMemory = false,
  startedAt = 0,
  reconcileCutoffMs = 0,
  supervisorOwnedRunIds = null,
}) {
  const id = String(runId ?? "").trim();
  if (!id) return false;
  if (inMemory) return false;
  const started = Number(startedAt ?? 0);
  const cutoff = Number(reconcileCutoffMs ?? 0);
  if (started && cutoff && started >= cutoff) return false;
  if (supervisorOwnedRunIds instanceof Set && supervisorOwnedRunIds.has(id)) return false;
  return true;
}

export async function readSupervisorOwnedRunIds(userDataDir) {
  const filePath = resolveTaskSupervisorRegistryFile(userDataDir);
  if (!filePath) return new Set();
  try {
    const raw = JSON.parse(await readFile(filePath, "utf8"));
    return supervisorOwnedRunIdsFromRegistry(raw);
  } catch {
    return new Set();
  }
}
