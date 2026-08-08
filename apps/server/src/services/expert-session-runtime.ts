import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { WorkspaceInfo } from "@onmyagent/types/server";

const EXPERT_SESSION_MARKER_NAME = "onmyagent-session.json";

export type ExpertSessionRuntimeDirectory = {
  directory: string;
  sessionKey: string;
  agentSegment: string;
};

export function resolveExpertSessionRuntimeRoot(): string {
  return process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT?.trim()
    || join(homedir(), ".onmyagent", "runtime", "expert-sessions");
}

export async function createExpertSessionRuntimeDirectory(input: {
  workspace: WorkspaceInfo;
  agentName: string;
  agentId?: string;
  sessionKey?: string;
  runtimeRoot?: string;
}): Promise<ExpertSessionRuntimeDirectory> {
  const runtimeRoot = resolve(input.runtimeRoot?.trim() || resolveExpertSessionRuntimeRoot());
  const workspaceRoot = resolve(input.workspace.path);
  if (isPathInside(workspaceRoot, runtimeRoot)) {
    throw new Error("Expert session runtime root must be outside the workspace");
  }
  const sessionKey = normalizeSessionKey(input.sessionKey);
  const nameSegment = sanitizePathSegment(input.agentName, "expert");
  const idSegment = input.agentId?.trim()
    ? sanitizePathSegment(input.agentId, "")
    : "";
  const agentSegment = idSegment ? `${nameSegment}-${idSegment}` : nameSegment;
  const workspaceSegment = createHash("sha256")
    .update(`${input.workspace.id}\0${workspaceRoot}`)
    .digest("hex")
    .slice(0, 16);
  const directory = join(runtimeRoot, workspaceSegment, agentSegment, sessionKey);
  if (!isPathInside(runtimeRoot, directory)) {
    throw new Error("Unsafe expert session runtime directory");
  }
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, EXPERT_SESSION_MARKER_NAME),
    `${JSON.stringify({
      kind: "expert-session",
      workspaceId: input.workspace.id,
      agent: agentSegment,
      sessionKey,
      runtime: true,
    }, null, 2)}\n`,
    "utf8",
  );
  return { directory, sessionKey, agentSegment };
}

function normalizeSessionKey(value?: string): string {
  const candidate = value?.trim() || Date.now().toString();
  return /^\d{10,16}$/.test(candidate) ? candidate : Date.now().toString();
}

function sanitizePathSegment(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/^\.+/, "")
    .replace(/[<>:"|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64)
    .trim();
  return cleaned || fallback;
}

function isPathInside(root: string, candidate: string): boolean {
  const normalizedRoot = resolve(root);
  const normalizedCandidate = resolve(candidate);
  return normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(`${normalizedRoot}${sep}`);
}
