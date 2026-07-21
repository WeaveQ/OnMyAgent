/**
 * Per-expert-session artifact directory helpers.
 *
 * When the user does not pick a folder for a new expert conversation, isolate
 * artifacts under: `{workspaceRoot}/{agentName}/{sessionKey}/`
 * so different experts and sessions never share the same dump folder.
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

export function createExpertSessionKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
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
 * Build an isolated session directory under the workspace when the user did
 * not pick an explicit folder.
 */
export function buildIsolatedExpertSessionDirectory(input: {
  workspaceRoot: string;
  agentName: string;
  sessionKey?: string;
}): {
  sessionKey: string;
  agentSegment: string;
  directory: string;
  markerRelativePath: string;
} {
  const sessionKey = input.sessionKey?.trim() || createExpertSessionKey();
  const agentSegment = sanitizePathSegment(input.agentName, "expert");
  const directory = joinWorkspacePath(input.workspaceRoot, agentSegment, sessionKey);
  const markerRelativePath = relativePosixPath(agentSegment, sessionKey, "README.md");
  return { sessionKey, agentSegment, directory, markerRelativePath };
}
