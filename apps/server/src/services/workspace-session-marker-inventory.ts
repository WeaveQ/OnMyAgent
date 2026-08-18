import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type {
  WorkspaceInfo,
  WorkspaceSessionListFailure,
} from "@onmyagent/types/server";
import {
  parseExpertSessionMarker,
  resolveExpertSessionRuntimeRoot,
  type ExpertSessionMarker,
} from "./expert-session-runtime.js";

const EXPERT_SESSION_MARKER_NAME = "onmyagent-session.json";

export type WorkspaceSessionMarkerInventoryEntry = {
  directory: string;
  key: string;
  agentSegment: string;
  sessionKey: string;
  marker: ExpertSessionMarker;
};

export type WorkspaceSessionMarkerInventoryResult = {
  entries: WorkspaceSessionMarkerInventoryEntry[];
  complete: boolean;
  failures: WorkspaceSessionListFailure[];
  fingerprint: string;
};

export async function scanWorkspaceExpertSessionMarkers(input: {
  workspace: WorkspaceInfo;
  runtimeRoot?: string;
  signal?: AbortSignal;
  maxDirectories?: number;
}): Promise<WorkspaceSessionMarkerInventoryResult> {
  throwIfAborted(input.signal);
  const runtimeRoot = resolve(
    input.runtimeRoot?.trim() || resolveExpertSessionRuntimeRoot(),
  );
  const workspaceRoot = resolve(input.workspace.path);
  const failures: WorkspaceSessionListFailure[] = [];
  const entries: WorkspaceSessionMarkerInventoryEntry[] = [];
  const maxDirectories = Math.max(1, input.maxDirectories ?? 64);

  if (isPathInside(workspaceRoot, runtimeRoot)) {
    failures.push({
      source: "expert-runtime",
      key: hashSourceKey("unsafe-runtime-root"),
      index: 0,
      code: "inventory_unavailable",
    });
    return finishInventory(entries, failures);
  }

  const canonicalRuntimeRoot = await resolveRuntimeRoot(runtimeRoot, input.signal);
  if (!canonicalRuntimeRoot) return finishInventory(entries, failures);
  const workspaceSegment = hashWorkspace(input.workspace.id, workspaceRoot);
  const workspaceDirectory = join(runtimeRoot, workspaceSegment);
  const canonicalWorkspaceDirectory = await resolveDirectory(
    workspaceDirectory,
    canonicalRuntimeRoot,
    input.signal,
  );
  if (canonicalWorkspaceDirectory === "missing") {
    return finishInventory(entries, failures);
  }
  if (!canonicalWorkspaceDirectory) {
    failures.push({
      source: "expert-runtime",
      key: hashSourceKey(workspaceSegment),
      index: 0,
      code: "inventory_unavailable",
    });
    return finishInventory(entries, failures);
  }

  const agentDirectories = await readDirectories(workspaceDirectory, input.signal);
  if (agentDirectories === null) {
    failures.push({
      source: "expert-runtime",
      key: hashSourceKey(workspaceSegment),
      index: 0,
      code: "inventory_unavailable",
    });
    return finishInventory(entries, failures);
  }

  let candidateIndex = 0;
  scanAgents: for (const agentEntry of agentDirectories) {
    throwIfAborted(input.signal);
    const agentDirectory = join(workspaceDirectory, agentEntry);
    const sessionDirectories = await readDirectories(agentDirectory, input.signal);
    if (sessionDirectories === null) {
      failures.push(failureFor("expert-runtime", `${agentEntry}`, candidateIndex, "inventory_unavailable"));
      candidateIndex += 1;
      continue;
    }
    for (const sessionEntry of sessionDirectories) {
      throwIfAborted(input.signal);
      const relativeKey = `${agentEntry}/${sessionEntry}`;
      if (candidateIndex >= maxDirectories) {
        failures.push(
          failureFor(
            "expert-runtime",
            relativeKey,
            candidateIndex,
            "directory_budget_exceeded",
          ),
        );
        break scanAgents;
      }
      const index = candidateIndex;
      candidateIndex += 1;
      const sessionDirectory = join(agentDirectory, sessionEntry);
      const canonicalSessionDirectory = await resolveDirectory(
        sessionDirectory,
        canonicalWorkspaceDirectory,
        input.signal,
      );
      if (!canonicalSessionDirectory || canonicalSessionDirectory === "missing") {
        failures.push(failureFor("expert-runtime", relativeKey, index, "marker_invalid"));
        continue;
      }
      const marker = parseExpertSessionMarker(
        await readMarker(sessionDirectory, input.signal),
        input.workspace.id,
      );
      if (!marker) {
        failures.push(failureFor("expert-runtime", relativeKey, index, "marker_invalid"));
        continue;
      }
      const key = hashSourceKey(relativeKey);
      if (entries.some((entry) => entry.directory === canonicalSessionDirectory)) continue;
      entries.push({
        directory: canonicalSessionDirectory,
        key,
        agentSegment: agentEntry,
        sessionKey: sessionEntry,
        marker,
      });
    }
  }

  return finishInventory(entries, failures);
}

function finishInventory(
  entries: WorkspaceSessionMarkerInventoryEntry[],
  failures: WorkspaceSessionListFailure[],
): WorkspaceSessionMarkerInventoryResult {
  const fingerprint = createHash("sha256")
    .update(entries.map((entry) => `${entry.key}:${entry.directory}:${JSON.stringify({
      isolationVersion: entry.marker.isolationVersion,
      agentId: entry.marker.agentId,
      packageName: entry.marker.packageName,
      sessionId: entry.marker.sessionId,
      runtimeKind: entry.marker.runtimeKind,
      runtimeSessionId: entry.marker.runtimeSessionId,
      profileId: entry.marker.profileId,
      declaredSkills: entry.marker.declaredSkills,
      installedSkills: entry.marker.installedSkills,
      missingSkills: entry.marker.missingSkills,
    })}`).join("\n"))
    .digest("hex")
    .slice(0, 16);
  return {
    entries,
    failures,
    complete: failures.length === 0,
    fingerprint,
  };
}

async function resolveRuntimeRoot(
  runtimeRoot: string,
  signal?: AbortSignal,
): Promise<string | null> {
  throwIfAborted(signal);
  try {
    const info = await lstat(runtimeRoot);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
    return await realpath(runtimeRoot);
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (isNotFound(error)) return "";
    return null;
  }
}

async function resolveDirectory(
  directory: string,
  canonicalParent: string,
  signal?: AbortSignal,
): Promise<string | null> {
  throwIfAborted(signal);
  try {
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) return null;
    const canonical = await realpath(directory);
    return isPathInside(canonicalParent, canonical) ? canonical : null;
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (isNotFound(error)) return "missing";
    return null;
  }
}

async function readDirectories(
  directory: string,
  signal?: AbortSignal,
): Promise<string[] | null> {
  throwIfAborted(signal);
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (isNotFound(error)) return [];
    return null;
  }
}

async function readMarker(directory: string, signal?: AbortSignal): Promise<unknown> {
  throwIfAborted(signal);
  try {
    const markerPath = join(directory, EXPERT_SESSION_MARKER_NAME);
    const info = await lstat(markerPath);
    if (!info.isFile() || info.isSymbolicLink()) return null;
    return JSON.parse(
      await readFile(markerPath, {
        encoding: "utf8",
        signal,
      }),
    ) as unknown;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return null;
  }
}

function failureFor(
  source: WorkspaceSessionListFailure["source"],
  value: string,
  index: number,
  code: WorkspaceSessionListFailure["code"],
): WorkspaceSessionListFailure {
  return { source, key: hashSourceKey(value), index, code };
}

function hashWorkspace(workspaceId: string, workspaceRoot: string): string {
  return createHash("sha256")
    .update(`${workspaceId}\0${workspaceRoot}`)
    .digest("hex")
    .slice(0, 16);
}

function hashSourceKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  throw new DOMException("The operation was aborted", "AbortError");
}
