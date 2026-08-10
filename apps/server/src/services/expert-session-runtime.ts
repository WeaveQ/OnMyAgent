import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { WorkspaceInfo } from "@onmyagent/types/server";

const EXPERT_SESSION_MARKER_NAME = "onmyagent-session.json";

export type ExpertSessionRuntimeDirectory = {
  directory: string;
  sessionKey: string;
  agentSegment: string;
};

export type AuthorizedArtifactResolutionRoot = {
  root: string;
  canonicalRoot: string;
  source: "workspace" | "expert-runtime";
};

export function resolveExpertSessionRuntimeRoot(): string {
  return process.env.ONMYAGENT_EXPERT_SESSION_RUNTIME_ROOT?.trim()
    || join(homedir(), ".onmyagent", "runtime", "expert-sessions");
}

/**
 * Accept a client-provided expert session root only when it is one of this
 * server's managed runtime directories and its marker belongs to the routed
 * workspace. This keeps artifact existence checks scoped to the current
 * expert session without trusting an arbitrary client filesystem path.
 */
export async function resolveAuthorizedExpertSessionRuntimeDirectory(input: {
  workspaceId: string;
  sessionRoot: string | undefined;
  runtimeRoot?: string;
}): Promise<string | null> {
  const sessionRoot = input.sessionRoot?.trim();
  if (!sessionRoot) return null;

  const runtimeRoot = resolve(input.runtimeRoot?.trim() || resolveExpertSessionRuntimeRoot());
  const directory = resolve(sessionRoot);
  if (!isPathInside(runtimeRoot, directory)) return null;

  try {
    const [resolvedRuntimeRoot, resolvedDirectory, runtimeRootInfo, info] = await Promise.all([
      realpath(runtimeRoot),
      realpath(directory),
      lstat(runtimeRoot),
      lstat(directory),
    ]);
    if (
      runtimeRootInfo.isSymbolicLink()
      || !info.isDirectory()
      || !isPathInside(resolvedRuntimeRoot, resolvedDirectory)
    ) {
      return null;
    }
    const marker = JSON.parse(
      await readFile(join(resolvedDirectory, EXPERT_SESSION_MARKER_NAME), "utf8"),
    ) as unknown;
    if (!isExpertSessionMarkerForWorkspace(marker, input.workspaceId)) return null;
    return directory;
  } catch {
    return null;
  }
}

/**
 * Resolve an explicitly supplied artifact root without granting arbitrary
 * filesystem access. A root may be a canonical child of the workspace (for
 * legacy/internal sessions) or a managed expert runtime directory.
 */
export async function resolveAuthorizedArtifactResolutionRoot(input: {
  workspace: WorkspaceInfo;
  sessionRoot: string | undefined;
  runtimeRoot?: string;
}): Promise<AuthorizedArtifactResolutionRoot | null> {
  const sessionRoot = input.sessionRoot?.trim();
  if (!sessionRoot) return null;

  const workspaceRoot = await resolveCanonicalDirectoryWithinRoot({
    root: input.workspace.path,
    candidate: sessionRoot,
  });
  if (workspaceRoot) return workspaceRoot;

  const expertRoot = await resolveAuthorizedExpertSessionRuntimeDirectory({
    workspaceId: input.workspace.id,
    sessionRoot,
    runtimeRoot: input.runtimeRoot,
  });
  if (!expertRoot) return null;
  const canonicalRoot = await realpath(expertRoot).catch(() => null);
  return canonicalRoot
    ? { root: expertRoot, canonicalRoot, source: "expert-runtime" }
    : null;
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
  // Prefer stable package/agent id only (not displayName-id doubles like
  // "项目复盘专家-kol-…kol-…"). Fall back to sanitized display name.
  const agentSegment = resolveExpertAgentSegment(input.agentName, input.agentId);
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

/**
 * Build a stable path segment for an expert agent.
 * Marketplace ids look like `pkg:pkg`; using only the package token avoids
 * doubled segments when displayName already contains the package slug.
 */
export function resolveExpertAgentSegment(
  agentName: string,
  agentId?: string,
): string {
  const idRaw = agentId?.trim() ?? "";
  const packageToken = idRaw
    ? (idRaw.includes(":")
        ? idRaw.split(":").map((part) => part.trim()).filter(Boolean).pop()
        : idRaw)
    : "";
  const fromId = packageToken
    ? sanitizePathSegment(packageToken, "")
    : "";
  if (fromId) return fromId;
  return sanitizePathSegment(agentName, "expert");
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

function isExpertSessionMarkerForWorkspace(
  marker: unknown,
  workspaceId: string,
): boolean {
  if (!marker || typeof marker !== "object") return false;
  const value = marker as Record<string, unknown>;
  return value.kind === "expert-session" && value.workspaceId === workspaceId;
}

async function resolveCanonicalDirectoryWithinRoot(input: {
  root: string;
  candidate: string;
}): Promise<AuthorizedArtifactResolutionRoot | null> {
  const root = resolve(input.root);
  const candidate = resolve(input.candidate);
  try {
    const [canonicalRoot, canonicalCandidate, info] = await Promise.all([
      realpath(root),
      realpath(candidate),
      stat(candidate),
    ]);
    if (!info.isDirectory() || !isPathInside(canonicalRoot, canonicalCandidate)) {
      return null;
    }
    return { root: candidate, canonicalRoot: canonicalCandidate, source: "workspace" };
  } catch {
    return null;
  }
}

export type ExpertSessionRuntimeFileEntry = {
  path: string;
  kind: "file" | "dir";
  size: number;
  mtimeMs: number;
  agentSegment: string;
  sessionKey: string;
};

/**
 * List every managed expert session artifact under the current workspace's
 * runtime directory. Returns flat entries whose `path` is
 * `<agentSegment>/<sessionKey>/<fileName>` so the UI can build an
 * agent -> session -> file outline from the existing file-tree helpers.
 *
 * Marker files (`onmyagent-session.json`), dotfiles and OS junk are filtered
 * server-side; the UI also hides them via `shouldHideEntry`.
 */
export async function listExpertSessionRuntimeFiles(input: {
  workspace: WorkspaceInfo;
  runtimeRoot?: string;
}): Promise<ExpertSessionRuntimeFileEntry[]> {
  const runtimeRoot = resolve(
    input.runtimeRoot?.trim() || resolveExpertSessionRuntimeRoot(),
  );
  const workspaceRoot = resolve(input.workspace.path);
  const workspaceSegment = createHash("sha256")
    .update(`${input.workspace.id}\0${workspaceRoot}`)
    .digest("hex")
    .slice(0, 16);
  const workspaceDir = join(runtimeRoot, workspaceSegment);

  const entries: ExpertSessionRuntimeFileEntry[] = [];
  let agentEntries: import("node:fs").Dirent[];
  try {
    agentEntries = await readdir(workspaceDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const agentEntry of agentEntries) {
    if (!agentEntry.isDirectory()) continue;
    const agentSegment = agentEntry.name;
    const agentDir = join(workspaceDir, agentSegment);

    let sessionEntries: import("node:fs").Dirent[];
    try {
      sessionEntries = await readdir(agentDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sessionEntry of sessionEntries) {
      if (!sessionEntry.isDirectory()) continue;
      const sessionKey = sessionEntry.name;
      const sessionDir = join(agentDir, sessionKey);

      let fileEntries: import("node:fs").Dirent[];
      try {
        fileEntries = await readdir(sessionDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const fileEntry of fileEntries) {
        if (!fileEntry.isFile()) continue;
        const fileName = fileEntry.name;
        if (fileName === EXPERT_SESSION_MARKER_NAME) continue;
        if (fileName === ".DS_Store" || fileName.startsWith(".")) continue;
        const abs = join(sessionDir, fileName);
        let info;
        try {
          info = await stat(abs);
        } catch {
          continue;
        }
        entries.push({
          path: `${agentSegment}/${sessionKey}/${fileName}`,
          kind: "file",
          size: info.size,
          mtimeMs: info.mtimeMs,
          agentSegment,
          sessionKey,
        });
      }
    }
  }

  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries;
}

/**
 * Resolve a single managed expert session artifact by its runtime-relative path
 * (`<agent>/<session>/<file>`). Returns the absolute path + stat when the file
 * exists inside the workspace's runtime directory, else null.
 *
 * Used by the runtime file read/download/resolve routes so the Files > Expert
 * tab can preview artifacts that live outside the workspace.
 */
export async function resolveExpertSessionRuntimeFile(input: {
  workspace: WorkspaceInfo;
  relPath: string;
  runtimeRoot?: string;
}): Promise<{ absPath: string; size: number; mtimeMs: number } | null> {
  const runtimeRoot = resolve(
    input.runtimeRoot?.trim() || resolveExpertSessionRuntimeRoot(),
  );
  const workspaceRoot = resolve(input.workspace.path);
  const workspaceSegment = createHash("sha256")
    .update(`${input.workspace.id}\0${workspaceRoot}`)
    .digest("hex")
    .slice(0, 16);
  const workspaceDir = join(runtimeRoot, workspaceSegment);

  const cleaned = String(input.relPath ?? "").trim().replace(/\\/g, "/");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    if (part === "." || part === "..") return null;
  }
  const absPath = resolve(join(workspaceDir, ...parts));
  if (!isPathInside(workspaceDir, absPath)) return null;
  try {
    const info = await stat(absPath);
    if (!info.isFile()) return null;
    return { absPath, size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return null;
  }
}
