/**
 * Per-expert-session directory helpers.
 *
 * New default sessions are allocated by the server under app runtime state.
 * Workspace-relative helpers remain for legacy sessions and explicit folders.
 */

/** Product layout root for expert archives (see workspace-files-layout). */
export const EXPERTS_LAYOUT_DIR = "experts";

export function sanitizePathSegment(raw: string, fallback = "expert"): string {
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

export function createExpertSessionKey(): string {
  // Use a timestamp so the key is deterministic and always available -
  // no UUID generation race that could leave the directory name empty.
  return Date.now().toString();
}

/**
 * True for legacy auto-isolated expert session dirs:
 * `{workspaceRoot}/experts/{agentName-agentId}/{Date.now()}/`
 * (legacy without `experts/` also matches by trailing timestamp key).
 *
 * Used to keep these out of the composer "选择工作空间" picker — they are
 * session artifact roots, not user-named spaces.
 */
export function isIsolatedExpertSessionDirectory(path: string): boolean {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  if (!trimmed) return false;
  const parts = trimmed.replace(/\\/g, "/").split("/").filter(Boolean);
  // Need at least agentSegment + timestamp under some root.
  if (parts.length < 2) return false;
  const base = parts[parts.length - 1] ?? "";
  // createExpertSessionKey() is Date.now() ms (10–16 digits covers past/near future).
  return /^\d{10,16}$/.test(base);
}

export function joinWorkspacePath(root: string, ...parts: string[]): string {
  const base = root.replace(/[\\/]+$/, "");
  const sep = root.includes("\\") ? "\\" : "/";
  const segments = parts
    .map((part) => part.replace(/^[\\/]+|[\\/]+$/g, "").trim())
    .filter(Boolean);
  return [base, ...segments].join(sep);
}

export function relativePosixPath(...parts: string[]): string {
  return parts
    .map((part) => part.replace(/^[\\/]+|[\\/]+$/g, "").trim())
    .filter(Boolean)
    .join("/");
}

export function normalizeDirectoryPathValue(path: string): string {
  return path.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
}

export function isSameDirectory(left: string, right: string): boolean {
  const a = normalizeDirectoryPathValue(left);
  const b = normalizeDirectoryPathValue(right);
  return Boolean(a) && a === b;
}

/**
 * Marker file that materializes the session directory via writeWorkspaceFile.
 * Hidden from the files panel via shouldHideEntry (name match), not a user README.
 */
export const EXPERT_SESSION_MARKER_NAME = "onmyagent-session.json";

/**
 * Build the legacy workspace-relative isolated session directory.
 *
 * Structure: `{workspaceRoot}/experts/{agentName-agentId}/{timestamp}/`
 * - experts/: product layout root for Expert files tab
 * - agentName-agentId: stable per expert, reused across sessions
 * - timestamp: deterministic at send time, no UUID race
 *
 * Callers must materialize the directory (write the marker file) before
 * binding the opencode session - opencode realPath fails if the path is missing.
 * @deprecated New default sessions must use createIsolatedExpertSessionRuntimeDirectory.
 */
export function buildIsolatedExpertSessionDirectory(input: {
  workspaceRoot: string;
  agentName: string;
  agentId?: string;
  sessionKey?: string;
}): {
  sessionKey: string;
  agentSegment: string;
  directory: string;
  /** Relative path under the workspace root for writeWorkspaceFile. */
  markerRelativePath: string;
  markerContent: string;
} {
  const sessionKey = input.sessionKey?.trim() || createExpertSessionKey();
  const nameSegment = sanitizePathSegment(input.agentName, "expert");
  const idSegment = input.agentId?.trim()
    ? sanitizePathSegment(input.agentId, "")
    : "";
  // {agentName}-{agentId} e.g. "油费稽核员-fuel-auditor"
  const agentSegment = idSegment
    ? `${nameSegment}-${idSegment}`
    : nameSegment;
  const directory = joinWorkspacePath(
    input.workspaceRoot,
    EXPERTS_LAYOUT_DIR,
    agentSegment,
    sessionKey,
  );
  // Must stay under experts/{agent}/{session}/ — same product layout as
  // resolveProductWriteRelativePath({ source: "expert", … }) (AC5).
  const markerRelativePath = relativePosixPath(
    EXPERTS_LAYOUT_DIR,
    agentSegment,
    sessionKey,
    EXPERT_SESSION_MARKER_NAME,
  );
  const markerContent = `${JSON.stringify(
    {
      kind: "expert-session",
      agent: agentSegment,
      sessionKey,
      layout: EXPERTS_LAYOUT_DIR,
    },
    null,
    2,
  )}\n`;
  return { sessionKey, agentSegment, directory, markerRelativePath, markerContent };
}

/**
 * True when the user did not pick a real folder (empty / same as workspace root).
 * Picking the workspace itself must still isolate, or the files panel scans the
 * whole project.
 */
export function shouldIsolateExpertSessionDirectory(
  workspaceRoot: string,
  draftOrBoundDirectory?: string | null,
): boolean {
  const workspace = workspaceRoot.trim();
  if (!workspace) return false;
  const draft = draftOrBoundDirectory?.trim() ?? "";
  return !draft || isSameDirectory(draft, workspace);
}

/**
 * Side-panel file root for a session. The session's own directory (stored in
 * the session record by the server at create time) is the primary source.
 * The localStorage boundDirectory is a fallback for legacy sessions created
 * before the directory was persisted to the session record.
 */
export function resolveSelectedSessionFileRoot(input: {
  boundDirectory?: string | null;
  sessionDirectory?: string | null;
  workspaceRoot: string;
}): string {
  const candidates = [
    input.sessionDirectory?.trim() ?? "",
    input.boundDirectory?.trim() ?? "",
  ].filter(Boolean);
  return candidates[0] ?? "";
}

/**
 * If `sessionDirectory` is a child of `workspaceRoot`, return the hidden marker
 * write payload used to materialize that directory. Otherwise null.
 */
export function resolveExpertSessionDirectoryMarker(
  workspaceRoot: string,
  sessionDirectory: string,
): { markerRelativePath: string; markerContent: string } | null {
  const root = workspaceRoot.trim().replace(/[\\/]+$/, "");
  const directory = sessionDirectory.trim().replace(/[\\/]+$/, "");
  if (!root || !directory || isSameDirectory(root, directory)) return null;

  const rootNorm = root.replace(/\\/g, "/");
  const dirNorm = directory.replace(/\\/g, "/");
  const rootKey = normalizeDirectoryPathValue(root);
  const dirKey = normalizeDirectoryPathValue(directory);
  if (!dirKey.startsWith(`${rootKey}/`)) return null;

  // Preserve original casing for the relative path when possible.
  const prefix = rootNorm.endsWith("/") ? rootNorm : `${rootNorm}/`;
  const relativeDir = dirNorm.toLowerCase().startsWith(prefix.toLowerCase())
    ? dirNorm.slice(prefix.length)
    : dirNorm.slice(rootNorm.length).replace(/^[\\/]+/, "");
  if (!relativeDir || relativeDir.includes("..")) return null;

  const parts = relativeDir.split(/[\\/]/).filter(Boolean);
  const markerRelativePath = relativePosixPath(...parts, EXPERT_SESSION_MARKER_NAME);
  const markerContent = `${JSON.stringify(
    {
      kind: "expert-session",
      directory: relativeDir.replace(/\\/g, "/"),
    },
    null,
    2,
  )}\n`;
  return { markerRelativePath, markerContent };
}

export type ExpertSessionDirectoryWriter = {
  writeWorkspaceFile: (
    workspaceId: string,
    payload: { path: string; content: string; force?: boolean },
  ) => Promise<unknown>;
};

export type ExpertSessionRuntimeDirectoryClient = {
  createExpertSessionRuntimeDirectory: (
    workspaceId: string,
    payload: {
      agentName: string;
      agentId?: string;
      packageName?: string;
      sessionId?: string;
      sessionKey?: string;
      approvedAgentIds?: string[];
      skillNames?: string[];
    },
  ) => Promise<{
    directory: string;
    sessionKey: string;
    agentSegment: string;
    installedSkills?: string[];
    declaredSkills?: string[];
    missingSkills?: string[];
    isolationVersion?: number;
    defaultAgent?: string;
  }>;
};

export async function createIsolatedExpertSessionRuntimeDirectory(input: {
  client: ExpertSessionRuntimeDirectoryClient | null | undefined;
  workspaceId: string | null | undefined;
  workspaceRoot: string;
  agentName: string;
  agentId?: string;
  packageName?: string;
  sessionId?: string;
  sessionKey?: string;
  approvedAgentIds?: string[];
  /** Declared expert skills only (frontmatter / package). */
  skillNames?: string[];
}): Promise<{ directory: string; sessionKey: string; agentSegment: string } | null> {
  const workspaceId = input.workspaceId?.trim() ?? "";
  if (!input.client || !workspaceId) return null;
  try {
    const result = await input.client.createExpertSessionRuntimeDirectory(workspaceId, {
      agentName: input.agentName,
      agentId: input.agentId,
      packageName: input.packageName,
      sessionId: input.sessionId,
      sessionKey: input.sessionKey,
      ...(input.approvedAgentIds?.length ? { approvedAgentIds: input.approvedAgentIds } : {}),
      ...(input.skillNames?.length ? { skillNames: input.skillNames } : {}),
    });
    const directory = result.directory?.trim() ?? "";
    const workspace = input.workspaceRoot.trim().replace(/[\\/]+$/, "");
    const normalizedDirectory = normalizeDirectoryPathValue(directory);
    const normalizedWorkspace = normalizeDirectoryPathValue(workspace);
    if (
      !directory
      || normalizedDirectory === normalizedWorkspace
      || normalizedDirectory.startsWith(`${normalizedWorkspace}/`)
    ) {
      console.warn("[expert-session] rejected runtime directory inside workspace", directory);
      return null;
    }
    return { ...result, directory };
  } catch (error) {
    console.warn("[expert-session] failed to create runtime directory", error);
    return null;
  }
}

/**
 * Ensure a session directory exists on disk by writing the hidden marker.
 * Returns true only when the write succeeds (opencode can realPath the dir).
 */
export async function materializeExpertSessionDirectory(input: {
  client: ExpertSessionDirectoryWriter | null | undefined;
  workspaceId: string | null | undefined;
  workspaceRoot: string;
  sessionDirectory: string;
}): Promise<boolean> {
  const client = input.client;
  const workspaceId = input.workspaceId?.trim() ?? "";
  if (!client || !workspaceId) return false;
  const marker = resolveExpertSessionDirectoryMarker(
    input.workspaceRoot,
    input.sessionDirectory,
  );
  if (!marker) return false;
  try {
    await client.writeWorkspaceFile(workspaceId, {
      path: marker.markerRelativePath,
      content: marker.markerContent,
      force: true,
    });
    return true;
  } catch (error) {
    console.warn(
      "[expert-session] failed to materialize session directory",
      input.sessionDirectory,
      error,
    );
    return false;
  }
}
