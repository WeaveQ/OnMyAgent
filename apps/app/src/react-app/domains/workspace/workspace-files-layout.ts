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

/** Automation run folder name prefix (server writes under tasks/). */
export const AUTOMATION_TASK_FOLDER_PREFIX = "自动化任务-";

export function isWorkspaceLayoutTopDir(name: string): boolean {
  return WORKSPACE_LAYOUT_TOP_DIR_SET.has(name.trim().toLowerCase());
}

export function isWorkspaceSystemTopDir(name: string): boolean {
  return WORKSPACE_SYSTEM_TOP_DIRS.has(name.trim().toLowerCase());
}

export function isAutomationTaskFolderName(name: string): boolean {
  return name.trim().startsWith(AUTOMATION_TASK_FOLDER_PREFIX);
}
