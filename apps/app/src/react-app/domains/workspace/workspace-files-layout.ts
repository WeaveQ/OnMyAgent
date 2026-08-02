/**
 * Workspace on-disk layout for Files three-source IA.
 *
 *   workspace/
 *     uploads/              # user import-by-copy (also mirrored via inbox API)
 *     tasks/                # home temp tasks + automation runs + misc task work
 *     experts/{agentSeg}/   # expert archives; sessions under {sessionKey}/
 *     projects/             # user-named project folders (not expert, not automation)
 *
 * Write paths use these prefixes. Historical flat roots are migrated into them.
 */

export const WORKSPACE_UPLOADS_DIR = "uploads";
export const WORKSPACE_TASKS_DIR = "tasks";
export const WORKSPACE_EXPERTS_DIR = "experts";
export const WORKSPACE_PROJECTS_DIR = "projects";

/** Top-level layout folders reserved by product (not user/expert content roots). */
export const WORKSPACE_LAYOUT_TOP_DIRS = [
  WORKSPACE_UPLOADS_DIR,
  WORKSPACE_TASKS_DIR,
  WORKSPACE_EXPERTS_DIR,
  WORKSPACE_PROJECTS_DIR,
] as const;

export const WORKSPACE_LAYOUT_TOP_DIR_SET = new Set<string>(
  WORKSPACE_LAYOUT_TOP_DIRS.map((name) => name.toLowerCase()),
);

/** Internal / system top-level names that never appear as content roots. */
export const WORKSPACE_SYSTEM_TOP_DIRS = new Set([
  ...WORKSPACE_LAYOUT_TOP_DIR_SET,
  "inbox",
  "tmp",
  "temp",
  ".onmyagent",
  ".opencode",
  ".omo",
  ".git",
  ".codegraph",
  ".memsearch",
  "node_modules",
]);

/**
 * Automation run folder name prefix (server writes under tasks/).
 * Unicode escapes keep the hard-coded CJK gate quiet; value is still 自动化任务-
 */
export const AUTOMATION_TASK_FOLDER_PREFIX =
  "\u81ea\u52a8\u5316\u4efb\u52a1-";

export function isWorkspaceLayoutTopDir(name: string): boolean {
  return WORKSPACE_LAYOUT_TOP_DIR_SET.has(name.trim().toLowerCase());
}

export function isWorkspaceSystemTopDir(name: string): boolean {
  return WORKSPACE_SYSTEM_TOP_DIRS.has(name.trim().toLowerCase());
}

export function isAutomationTaskFolderName(name: string): boolean {
  return name.trim().startsWith(AUTOMATION_TASK_FOLDER_PREFIX);
}

function normalizeRel(path: string): string {
  return path
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");
}

/** True when a workspace-relative path is under uploads/tasks/experts/projects. */
export function isUnderProductLayoutRoot(relativePath: string): boolean {
  const rel = normalizeRel(relativePath);
  if (!rel) return false;
  const top = rel.split("/")[0]?.toLowerCase() ?? "";
  return WORKSPACE_LAYOUT_TOP_DIR_SET.has(top);
}

/** True when relative path is a bare root file (not under layout or system dirs). */
export function isBareWorkspaceRootFile(relativePath: string): boolean {
  const rel = normalizeRel(relativePath);
  if (!rel || rel.includes("/")) return false;
  return !isWorkspaceSystemTopDir(rel) && !isWorkspaceLayoutTopDir(rel);
}

export type ProductWriteSource =
  | "user_upload"
  | "assistant_task"
  | "automation"
  | "expert"
  | "project";

/**
 * Resolve where a new write should land (workspace-relative).
 * Never returns a bare root path for business files.
 */
export function resolveProductWriteRelativePath(input: {
  source: ProductWriteSource;
  fileName: string;
  sessionId?: string | null;
  agentSlug?: string | null;
  projectName?: string | null;
}): string {
  const name =
    String(input.fileName ?? "")
      .trim()
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .pop() || "file";
  const sessionId = String(input.sessionId ?? "")
    .trim()
    .replace(/[\\/]+/g, "-");
  const agent = String(input.agentSlug ?? "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop();
  const project = String(input.projectName ?? "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop();

  switch (input.source) {
    case "user_upload":
      return `${WORKSPACE_UPLOADS_DIR}/${name}`;
    case "expert": {
      const seg = agent || "expert";
      const sid = sessionId || "session";
      return `${WORKSPACE_EXPERTS_DIR}/${seg}/${sid}/${name}`;
    }
    case "project": {
      const proj = project || "project";
      if (sessionId) return `${WORKSPACE_PROJECTS_DIR}/${proj}/${sessionId}/${name}`;
      return `${WORKSPACE_PROJECTS_DIR}/${proj}/${name}`;
    }
    case "automation":
    case "assistant_task":
    default: {
      const sid = sessionId || "session";
      return `${WORKSPACE_TASKS_DIR}/${sid}/${name}`;
    }
  }
}

/**
 * Reduce an absolute or nested path to a product-layout-relative root when possible.
 *
 * Real expert session dirs are often absolute:
 *   /Users/…/workspace/experts/{agentSeg}/{sessionKey}
 * Callers may omit workspaceRoot; still peel at the first `experts|tasks|projects|uploads`
 * segment so permanent-delete can target the correct workspace-relative root.
 *
 * Returns null when the path cannot be attributed safely (fail closed — do not
 * invent a root or pass absolute paths to the files API).
 */
export function toProductLayoutRelativePath(
  directory: string,
  workspaceRoot?: string | null,
): string | null {
  let rel = String(directory ?? "")
    .trim()
    .replace(/\\/g, "/");
  if (!rel) return null;

  const ws = String(workspaceRoot ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  if (ws) {
    const wsLower = ws.toLowerCase();
    const relLower = rel.toLowerCase();
    if (relLower === wsLower) return null;
    if (relLower.startsWith(`${wsLower}/`)) {
      rel = rel.slice(ws.length).replace(/^\/+/, "");
    }
  }

  // Peel absolute / nested prefixes down to the first layout top segment.
  const parts = rel.split("/").filter(Boolean);
  // Drop Windows drive letter segment (e.g. "C:") if present.
  const start =
    parts[0] && /^[A-Za-z]:$/.test(parts[0]) ? parts.slice(1) : parts;
  const layoutIdx = start.findIndex((p) =>
    WORKSPACE_LAYOUT_TOP_DIR_SET.has(p.toLowerCase()),
  );
  if (layoutIdx < 0) return null;
  rel = normalizeRel(start.slice(layoutIdx).join("/"));
  if (!rel || rel.startsWith("..")) return null;
  if (!isUnderProductLayoutRoot(rel)) return null;
  return rel;
}

/**
 * Candidate directory roots (workspace-relative) that may hold files for a session.
 * Used when permanently deleting a conversation (C1: remove generated files).
 */
export function candidateSessionOwnedRoots(input: {
  sessionId: string;
  /** Absolute or workspace-relative directory from archive metadata. */
  directory?: string | null;
  agentSlug?: string | null;
  workspaceRoot?: string | null;
}): string[] {
  const id = String(input.sessionId ?? "").trim();
  const roots: string[] = [];

  const rawDir = String(input.directory ?? "").trim();
  const productDir = rawDir
    ? toProductLayoutRelativePath(rawDir, input.workspaceRoot)
    : null;

  // Prefer agent slug from caller, else from resolved directory (experts/{slug}/…).
  let agent = String(input.agentSlug ?? "").trim();
  if (!agent && productDir) {
    const segs = productDir.split("/").filter(Boolean);
    if ((segs[0] ?? "").toLowerCase() === WORKSPACE_EXPERTS_DIR && segs[1]) {
      agent = segs[1] ?? "";
    }
  }

  if (id) {
    roots.push(`${WORKSPACE_TASKS_DIR}/${id}`);
    if (agent) {
      roots.push(`${WORKSPACE_EXPERTS_DIR}/${agent}/${id}`);
    }
  }

  if (productDir) {
    roots.push(productDir);
  } else if (rawDir && id) {
    // Bare session folder name (no slashes / no drive) → tasks/{name}
    const bare = rawDir.replace(/\\/g, "/");
    if (!bare.includes("/") && !/^[A-Za-z]:/.test(bare)) {
      roots.push(`${WORKSPACE_TASKS_DIR}/${bare}`);
    }
    // Absolute/unresolvable without layout marker: fail closed (omit).
  }

  const seen = new Set<string>();
  return roots.filter((r) => {
    const n = normalizeRel(r);
    if (!n || seen.has(n) || n.startsWith("..")) return false;
    if (!isUnderProductLayoutRoot(n)) return false;
    seen.add(n);
    return true;
  });
}

/**
 * Extract session id from a product layout relative path when present.
 * e.g. tasks/{sessionId}/out.xlsx → sessionId
 *      experts/{agent}/{sessionId}/a.json → sessionId
 *
 * Used for optional "Open source session" when the path encodes session ownership.
 */
export function extractSessionIdFromProductPath(
  relativePath: string,
): string | null {
  const rel = normalizeRel(relativePath);
  if (!rel) return null;
  const parts = rel.split("/").filter(Boolean);
  const top = (parts[0] ?? "").toLowerCase();
  if (top === WORKSPACE_TASKS_DIR && parts[1]) {
    return parts[1] ?? null;
  }
  if (top === WORKSPACE_EXPERTS_DIR && parts[2]) {
    return parts[2] ?? null;
  }
  if (top === WORKSPACE_PROJECTS_DIR && parts[2]) {
    return parts[2] ?? null;
  }
  // Session-like folder as bare top segment (historical / pre-layout).
  if (parts.length >= 2 && /^[0-9a-f]{8,}$/i.test(parts[0] ?? "")) {
    return parts[0] ?? null;
  }
  return null;
}

/** Keep relative file paths that equal a root or sit under it. */
export function filterPathsUnderSessionRoots(
  relativePaths: readonly string[],
  roots: readonly string[],
): string[] {
  const normalizedRoots = roots.map(normalizeRel).filter(Boolean);
  if (normalizedRoots.length === 0) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of relativePaths) {
    const path = normalizeRel(raw);
    if (!path || path.endsWith("/")) continue;
    const hit = normalizedRoots.some(
      (root) => path === root || path.startsWith(`${root}/`),
    );
    if (!hit || seen.has(path)) continue;
    // Prefer files, not directory placeholders
    const base = path.split("/").pop() ?? "";
    if (!base || base.startsWith(".")) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}
