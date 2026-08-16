/**
 * Knowledge vault list / read / write / delete. Path-safe, text files only.
 */
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { readKnowledgeConfig } from "./knowledge-vault-config.mjs";
import { ensureKnowledgeVault } from "./ensure-knowledge-vault.mjs";
import {
  invalidateKnowledgeIndex,
  rebuildAndCommitKnowledgeIndex,
  searchKnowledgeNotes,
} from "./knowledge-vault-index.mjs";
import {
  assertSafeKnowledgeRelPath,
  GETTING_STARTED_REL_PATH,
  isIndexableKnowledgeFile,
  resolveKnowledgeRoot,
  resolveKnowledgeScopeDir,
  resolveKnowledgeSessionDefaultsPath,
} from "./knowledge-vault-paths.mjs";
import { WALK_MAX_BYTES, walkKnowledgeTree } from "./knowledge-vault-walk.mjs";

const MAX_FILE_BYTES = WALK_MAX_BYTES;

/**
 * @param {{
 *   scope?: "user" | "project" | "expert" | "all",
 *   workspaceId?: string,
 *   expertId?: string,
 * }} input
 * @returns {Array<{ scope: "user" | "project" | "expert", workspaceId?: string, expertId?: string }>}
 */
function requestedScopes(input) {
  const scope = input.scope === "all" || !input.scope ? "all" : input.scope;
  if (scope === "user") return [{ scope: "user" }];
  if (scope === "project") {
    return input.workspaceId
      ? [{ scope: "project", workspaceId: input.workspaceId }]
      : [];
  }
  if (scope === "expert") {
    return input.expertId ? [{ scope: "expert", expertId: input.expertId }] : [];
  }
  /** @type {Array<{ scope: "user" | "project" | "expert", workspaceId?: string, expertId?: string }>} */
  const scopes = [{ scope: "user" }];
  if (input.workspaceId) {
    scopes.push({ scope: "project", workspaceId: input.workspaceId });
  }
  if (input.expertId) {
    scopes.push({ scope: "expert", expertId: input.expertId });
  }
  return scopes;
}

/**
 * @param {{
 *   homeDir?: string,
 *   scope?: "user" | "project" | "expert" | "all",
 *   workspaceId?: string,
 *   expertId?: string,
 * }} input
 */
/**
 * @param {{
 *   homeDir?: string,
 *   workspaceId?: string,
 *   expertId?: string,
 * }} input
 */
export async function writeKnowledgeSessionDefaults(input = {}) {
  const root = resolveKnowledgeRoot(input.homeDir);
  await mkdir(root, { recursive: true });
  const payload = {
    workspaceId: String(input.workspaceId ?? "").trim(),
    expertId: String(input.expertId ?? "").trim(),
  };
  await writeFile(
    resolveKnowledgeSessionDefaultsPath(input.homeDir),
    `${JSON.stringify(payload)}\n`,
    "utf8",
  );
  return { ok: true, ...payload, path: resolveKnowledgeSessionDefaultsPath(input.homeDir) };
}

export async function listKnowledgeVault(input = {}) {
  const ensured = await ensureKnowledgeVault({ homeDir: input.homeDir });
  const root = ensured.root;
  const userVaultDir = readKnowledgeConfig(input.homeDir).resolvedUserVaultDir;
  if (input.workspaceId || input.expertId) {
    await writeKnowledgeSessionDefaults(input);
  }
  const scopes = [];
  for (const item of requestedScopes(input)) {
    const dir = resolveKnowledgeScopeDir(root, item.scope, { ...item, userVaultDir });
    if (!dir) continue;
    await mkdir(dir, { recursive: true });
    scopes.push({
      scope: item.scope,
      path: dir,
      files: await walkKnowledgeTree(dir, { includeNonIndexable: true }),
    });
  }
  return { ok: true, root, scopes };
}

function resolveFile(input) {
  const relPath = assertSafeKnowledgeRelPath(input.relPath);
  const scope = input.scope === "project" || input.scope === "expert" ? input.scope : "user";
  const root = resolveKnowledgeRoot(input.homeDir);
  const dir = resolveKnowledgeScopeDir(root, scope, {
    ...input,
    userVaultDir: readKnowledgeConfig(input.homeDir).resolvedUserVaultDir,
  });
  if (!dir) {
    throw Object.assign(new Error("invalid_scope"), { reason: "invalid_scope" });
  }
  return {
    relPath,
    scope,
    dir,
    abs: path.join(dir, ...relPath.split("/")),
  };
}

/**
 * @param {{
 *   homeDir?: string,
 *   scope?: "user" | "project" | "expert",
 *   relPath: string,
 *   workspaceId?: string,
 *   expertId?: string,
 * }} input
 */
export async function readKnowledgeFile(input) {
  await ensureKnowledgeVault({ homeDir: input.homeDir });
  const target = resolveFile(input);
  if (!isIndexableKnowledgeFile(target.relPath)) {
    return { ok: false, reason: "unsupported_type", path: target.abs, relPath: target.relPath };
  }
  let st;
  try {
    st = await stat(target.abs);
  } catch {
    return { ok: false, reason: "not_found", path: target.abs, relPath: target.relPath };
  }
  if (!st.isFile()) {
    return { ok: false, reason: "not_found", path: target.abs, relPath: target.relPath };
  }
  if (st.size > MAX_FILE_BYTES) {
    return { ok: false, reason: "too_large", path: target.abs, relPath: target.relPath, size: st.size };
  }
  const content = await readFile(target.abs, "utf8");
  return {
    ok: true,
    scope: target.scope,
    relPath: target.relPath,
    path: target.abs,
    content,
    size: st.size,
    mtimeMs: st.mtimeMs,
  };
}

/**
 * @param {{
 *   homeDir?: string,
 *   scope?: "user" | "project" | "expert",
 *   relPath: string,
 *   content: string,
 *   workspaceId?: string,
 *   expertId?: string,
 * }} input
 */
export async function writeKnowledgeFile(input) {
  await ensureKnowledgeVault({ homeDir: input.homeDir });
  const target = resolveFile(input);
  if (!isIndexableKnowledgeFile(target.relPath)) {
    return { ok: false, reason: "unsupported_type", path: target.abs, relPath: target.relPath };
  }
  const content = typeof input.content === "string" ? input.content : "";
  if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
    return { ok: false, reason: "too_large", path: target.abs, relPath: target.relPath };
  }
  await mkdir(path.dirname(target.abs), { recursive: true });
  await writeFile(target.abs, content, "utf8");
  invalidateKnowledgeIndex(input.homeDir);
  const st = await stat(target.abs);
  return {
    ok: true,
    scope: target.scope,
    relPath: target.relPath,
    path: target.abs,
    size: st.size,
    mtimeMs: st.mtimeMs,
  };
}

/**
 * @param {{
 *   homeDir?: string,
 *   scope?: "user" | "project" | "expert",
 *   relPath: string,
 *   workspaceId?: string,
 *   expertId?: string,
 * }} input
 */
export async function deleteKnowledgeFile(input) {
  const target = resolveFile(input);
  if (target.scope === "user" && target.relPath === GETTING_STARTED_REL_PATH) {
    return { ok: false, reason: "protected", relPath: target.relPath, path: target.abs };
  }
  await rm(target.abs, { force: true });
  invalidateKnowledgeIndex(input.homeDir);
  return { ok: true, scope: target.scope, relPath: target.relPath, path: target.abs };
}

/**
 * @param {{
 *   homeDir?: string,
 *   query: string,
 *   scope?: "user" | "project" | "expert" | "all",
 *   workspaceId?: string,
 *   expertId?: string,
 *   limit?: number,
 * }} input
 */
export async function searchKnowledgeVault(input) {
  await ensureKnowledgeVault({ homeDir: input.homeDir });
  if (input.workspaceId || input.expertId) {
    await writeKnowledgeSessionDefaults(input);
  }
  return searchKnowledgeNotes({
    homeDir: input.homeDir,
    query: input.query,
    scopes: requestedScopes(input),
    limit: input.limit,
  });
}

/**
 * @param {{
 *   homeDir?: string,
 *   scope?: "user" | "project" | "expert" | "all",
 *   workspaceId?: string,
 *   expertId?: string,
 * }} input
 */
export async function rebuildKnowledgeVaultIndex(input = {}) {
  await ensureKnowledgeVault({ homeDir: input.homeDir });
  return rebuildAndCommitKnowledgeIndex({
    homeDir: input.homeDir,
    scopes: requestedScopes(input),
  });
}

export { MAX_FILE_BYTES };
