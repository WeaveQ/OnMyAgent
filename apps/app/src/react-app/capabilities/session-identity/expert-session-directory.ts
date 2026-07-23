/**
 * Per-expert-session artifact directory helpers.
 *
 * When the user does not pick a folder for a new expert conversation, isolate
 * artifacts under: `{workspaceRoot}/{agentName}/{agentName-YYYY-MM-DD-HHmmss}/`
 * so different experts and sessions never share the same dump folder, and the
 * workspace picker can show a clean "Name · date" label (not a raw hash).
 */

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

/** Local stamp: 2026-07-23-143052 (date + compact time for uniqueness). */
export function formatExpertSessionStamp(date: Date = new Date()): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${d}-${hh}${mm}${ss}`;
}

/**
 * Folder segment for a new isolated expert session.
 * Prefer `{agentName}-{YYYY-MM-DD-HHmmss}` so the picker last-segment is readable.
 * When `agentName` is omitted, fall back to stamp only (legacy callers).
 */
export function createExpertSessionKey(agentName?: string): string {
  const stamp = formatExpertSessionStamp();
  const raw = agentName?.trim();
  if (!raw) return stamp;
  const name = sanitizePathSegment(raw, "expert").slice(0, 40);
  return `${name}-${stamp}`;
}

/**
 * Human label for the draft-workspace / spaces list.
 * - New: `物流单专家-2026-07-23-143052` → `物流单专家 · 2026-07-23 14:30`
 * - Legacy hash under agent folder: `…/物流单专家/e4fae6588c5f` → `物流单专家 · e4fae6`
 * - Otherwise: last path segment
 */
export function formatExpertWorkspaceListLabel(path: string): string {
  const segments = path
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean);
  const last = segments[segments.length - 1] ?? path.trim();
  const parent = segments[segments.length - 2];

  const namedStamp = last.match(/^(.+)-(\d{4}-\d{2}-\d{2})-(\d{6})$/);
  if (namedStamp) {
    const [, name, date, time] = namedStamp;
    const hh = time.slice(0, 2);
    const mm = time.slice(2, 4);
    return `${name} · ${date} ${hh}:${mm}`;
  }

  // Legacy: 12-char hex session key under `{agentName}/`
  if (parent && /^[a-f0-9]{12}$/i.test(last)) {
    return `${parent} · ${last.slice(0, 6)}`;
  }

  return last;
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
 * Build an isolated session directory under the workspace when the user did
 * not pick an explicit folder.
 *
 * Callers must materialize the directory (write the marker file) before
 * binding the opencode session — opencode realPath fails if the path is missing.
 */
export function buildIsolatedExpertSessionDirectory(input: {
  workspaceRoot: string;
  agentName: string;
  sessionKey?: string;
}): {
  sessionKey: string;
  agentSegment: string;
  directory: string;
  /** Relative path under the workspace root for writeWorkspaceFile. */
  markerRelativePath: string;
  markerContent: string;
} {
  const agentSegment = sanitizePathSegment(input.agentName, "expert");
  const sessionKey =
    input.sessionKey?.trim() || createExpertSessionKey(agentSegment);
  const directory = joinWorkspacePath(input.workspaceRoot, agentSegment, sessionKey);
  const markerRelativePath = relativePosixPath(
    agentSegment,
    sessionKey,
    EXPERT_SESSION_MARKER_NAME,
  );
  const markerContent = `${JSON.stringify(
    {
      kind: "expert-session",
      agent: agentSegment,
      sessionKey,
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
 * Side-panel file root for a session. An explicitly bound directory wins,
 * including the workspace root: the folder selected when creating the session
 * is the scope the user expects to browse. Transcript artifacts are only used
 * when the session has no directory information at all.
 */
export function resolveSelectedSessionFileRoot(input: {
  boundDirectory?: string | null;
  sessionDirectory?: string | null;
  workspaceRoot: string;
}): string {
  const candidates = [
    input.boundDirectory?.trim() ?? "",
    input.sessionDirectory?.trim() ?? "",
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
