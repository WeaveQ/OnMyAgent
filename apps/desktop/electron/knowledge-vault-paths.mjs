/**
 * Local knowledge vault paths.
 *
 * Filesystem SoT: ~/.onmyagent/data/user/knowledge/
 *   vault/                      default user notes
 *   projects/<workspaceId>/     project notes
 *   experts/<expertId>/         expert notes
 *   index.sqlite                FTS5 (not a note)
 *   config.json                 optional personalVaultPath override
 *
 * Distinct from skills (profiles/.../skills) and work memory (data/user/awareness).
 */
import os from "node:os";
import path from "node:path";

export const KNOWLEDGE_SCOPES = Object.freeze(["user", "project", "expert"]);

export const GETTING_STARTED_REL_PATH = "getting-started.md";

export {
  WALK_INDEXABLE_EXTENSIONS as INDEXABLE_EXTENSIONS,
  isWalkHiddenName as isHiddenKnowledgeName,
  isWalkIndexableRelPath as isIndexableKnowledgeFile,
  walkFileExtension as knowledgeFileExtension,
} from "./knowledge-vault-walk.mjs";

const SCOPE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._@+-]{0,127}$/;

/**
 * @param {string} [homeDir]
 */
export function resolveKnowledgeRoot(homeDir) {
  const home = String(homeDir ?? os.homedir()).trim() || os.homedir();
  return path.join(home, ".onmyagent", "data", "user", "knowledge");
}

/**
 * @param {string} [homeDir]
 */
export function resolveDefaultUserVaultDir(homeDir) {
  return path.join(resolveKnowledgeRoot(homeDir), "vault");
}

/** @deprecated Use resolveDefaultUserVaultDir or readKnowledgeConfig().resolvedUserVaultDir */
export function resolveUserVaultDir(homeDir) {
  return resolveDefaultUserVaultDir(homeDir);
}

/**
 * @param {string} [homeDir]
 */
export function resolveKnowledgeConfigPath(homeDir) {
  return path.join(resolveKnowledgeRoot(homeDir), "config.json");
}

/**
 * @param {string} [homeDir]
 */
export function resolveKnowledgeIndexPath(homeDir) {
  return path.join(resolveKnowledgeRoot(homeDir), "index.sqlite");
}

/**
 * @param {string} [homeDir]
 */
export function resolveKnowledgeSessionDefaultsPath(homeDir) {
  return path.join(resolveKnowledgeRoot(homeDir), "session-defaults.json");
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function sanitizeKnowledgeScopeId(value) {
  const id = String(value ?? "").trim();
  if (!SCOPE_ID_RE.test(id)) return null;
  return id;
}

/**
 * @param {string} root
 * @param {"user" | "project" | "expert"} scope
 * @param {{ workspaceId?: string, expertId?: string, userVaultDir?: string }} [ids]
 */
export function resolveKnowledgeScopeDir(root, scope, ids = {}) {
  if (scope === "user") {
    const override = String(ids.userVaultDir ?? "").trim();
    return override || path.join(root, "vault");
  }
  if (scope === "project") {
    const id = sanitizeKnowledgeScopeId(ids.workspaceId);
    return id ? path.join(root, "projects", id) : null;
  }
  if (scope === "expert") {
    const id = sanitizeKnowledgeScopeId(ids.expertId);
    return id ? path.join(root, "experts", id) : null;
  }
  return null;
}

/**
 * Normalize and reject traversal. Returns posix-style relative path.
 * @param {unknown} relPath
 * @returns {string}
 */
export function assertSafeKnowledgeRelPath(relPath) {
  const rel = String(relPath ?? "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .trim();
  if (!rel || rel.includes("\0")) {
    throw Object.assign(new Error("invalid_path"), { reason: "invalid_path" });
  }
  const parts = rel.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw Object.assign(new Error("invalid_path"), { reason: "invalid_path" });
  }
  return parts.join("/");
}
