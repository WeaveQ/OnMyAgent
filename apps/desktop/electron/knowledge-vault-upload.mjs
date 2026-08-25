/**
 * Knowledge vault bulk creation: folders and file/folder uploads.
 *
 * All writes stay under the resolved scope directory. Relative paths are
 * normalized, traversal (`..`) is rejected, and existing parents are created.
 * Uploads above the indexable size/type limits are stored on disk but marked
 * non-indexable by the existing walk (we do not filter them here).
 */
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  assertSafeKnowledgeRelPath,
  resolveKnowledgeRoot,
  resolveKnowledgeScopeDir,
} from "./knowledge-vault-paths.mjs";
import { readKnowledgeConfig } from "./knowledge-vault-config.mjs";

/**
 * Join a destination folder with an entry name, rejecting anything that
 * escapes the vault root after normalization.
 * @param {string} scopeDir
 * @param {string} destFolder
 * @param {string} name
 * @returns {string} absolute target path
 */
export function safeJoinUnderScope(scopeDir, destFolder, name) {
  const folder = String(destFolder ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
  const relName = assertSafeKnowledgeRelPath(name);
  const relFolder = folder ? assertSafeKnowledgeRelPath(folder) : "";
  const rel = relFolder ? `${relFolder}/${relName}` : relName;
  // assertSafeKnowledgeRelPath rejects literal `.`/`..` segments, but a name
  // like `a/../../b` normalizes away; reject any `..` segment and require the
  // resolved path to stay under scope (defense in depth).
  if (rel.split("/").some((part) => part === "..")) {
    throw Object.assign(new Error("invalid_path"), { reason: "invalid_path" });
  }
  const normalizedRoot = path.resolve(scopeDir);
  const abs = path.resolve(normalizedRoot, ...rel.split("/"));
  if (abs !== normalizedRoot && !abs.startsWith(normalizedRoot + path.sep)) {
    throw Object.assign(new Error("invalid_path"), { reason: "invalid_path" });
  }
  return abs;
}

/**
 * @param {{
 *   homeDir?: string,
 *   scope: "user" | "project" | "expert",
 *   workspaceId?: string,
 *   expertId?: string,
 * }} input
 * @returns {Promise<string>}
 */
async function resolveScopeDir(input) {
  const root = resolveKnowledgeRoot(input.homeDir);
  const dir = resolveKnowledgeScopeDir(root, input.scope, {
    ...input,
    userVaultDir: readKnowledgeConfig(input.homeDir).resolvedUserVaultDir,
  });
  if (!dir) throw Object.assign(new Error("invalid_scope"), { reason: "invalid_scope" });
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Create a folder (and any missing parents) under the scope.
 * @param {{homeDir?: string, scope, relPath, workspaceId?, expertId?}} input
 */
export async function createKnowledgeFolder(input) {
  const scopeDir = await resolveScopeDir(input);
  const rel = assertSafeKnowledgeRelPath(input.relPath);
  const abs = path.join(scopeDir, ...rel.split("/"));
  const normalizedRoot = path.resolve(scopeDir);
  if (!path.resolve(abs).startsWith(normalizedRoot + path.sep)) {
    throw Object.assign(new Error("invalid_path"), { reason: "invalid_path" });
  }
  await mkdir(abs, { recursive: true });
  return { ok: true, scope: input.scope, relPath: rel };
}

function decodeBase64(dataBase64) {
  return Buffer.from(String(dataBase64 ?? ""), "base64");
}

/**
 * Upload one or more files into the vault. Each entry may provide either an
 * absolute source path to copy, or base64 content. Names are taken from the
 * entry or the source file basename.
 * @param {{homeDir?: string, scope, destFolder?, workspaceId?, expertId?,
 *   files: Array<{name?: string, sourcePath?: string, dataBase64?: string}>}} input
 */
export async function uploadKnowledgeFiles(input) {
  const scopeDir = await resolveScopeDir(input);
  const results = [];
  for (const file of input.files ?? []) {
    try {
      const name = String(file?.name ?? (file?.sourcePath ? path.basename(file.sourcePath) : "")).trim();
      if (!name) throw Object.assign(new Error("invalid_name"), { reason: "invalid_path" });
      const abs = safeJoinUnderScope(scopeDir, input.destFolder, name);
      await mkdir(path.dirname(abs), { recursive: true });
      if (file.sourcePath) {
        await copyFile(path.resolve(String(file.sourcePath)), abs);
      } else {
        await writeFile(abs, decodeBase64(file?.dataBase64));
      }
      const rel = path.relative(scopeDir, abs).split(path.sep).join("/");
      results.push({ ok: true, name, relPath: rel });
    } catch (error) {
      results.push({
        ok: false,
        name: String(file?.name ?? file?.sourcePath ?? ""),
        reason: error?.reason ?? "upload_failed",
      });
    }
  }
  return { ok: true, results };
}

/**
 * Recursively upload a folder from a local source directory, preserving its
 * relative tree under destFolder.
 * @param {{homeDir?: string, scope, sourcePath: string, destFolder?, workspaceId?, expertId?}} input
 */
export async function uploadKnowledgeFolderFromDisk(input) {
  const scopeDir = await resolveScopeDir(input);
  const sourceRoot = path.resolve(String(input.sourcePath ?? ""));
  const results = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const sourceAbs = path.join(current, entry.name);
      const rel = path.relative(sourceRoot, sourceAbs).split(path.sep).join("/");
      if (entry.isDirectory()) {
        await walk(sourceAbs);
      } else if (entry.isFile()) {
        try {
          const target = safeJoinUnderScope(
            scopeDir,
            input.destFolder,
            path.basename(sourceRoot) ? `${path.basename(sourceRoot)}/${rel}` : rel,
          );
          await mkdir(path.dirname(target), { recursive: true });
          await copyFile(sourceAbs, target);
          results.push({ ok: true, relPath: path.relative(scopeDir, target).split(path.sep).join("/") });
        } catch (error) {
          results.push({ ok: false, relPath: rel, reason: error?.reason ?? "upload_failed" });
        }
      }
    }
  }
  await walk(sourceRoot);
  return { ok: true, results };
}

/**
 * Recursively upload a folder's entries, preserving relative paths.
 * @param {{homeDir?: string, scope, destFolder?, workspaceId?, expertId?,
 *   entries: Array<{relPath: string, dataBase64: string}>}} input
 */
export async function uploadKnowledgeFolder(input) {
  const scopeDir = await resolveScopeDir(input);
  const results = [];
  for (const entry of input.entries ?? []) {
    try {
      const rel = assertSafeKnowledgeRelPath(
        [input.destFolder, entry.relPath].filter(Boolean).join("/"),
      );
      const abs = path.join(scopeDir, ...rel.split("/"));
      if (!path.resolve(abs).startsWith(path.resolve(scopeDir) + path.sep)) {
        throw Object.assign(new Error("invalid_path"), { reason: "invalid_path" });
      }
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, decodeBase64(entry.dataBase64));
      results.push({ ok: true, relPath: rel });
    } catch (error) {
      results.push({
        ok: false,
        relPath: String(entry?.relPath ?? ""),
        reason: error?.reason ?? "upload_failed",
      });
    }
  }
  return { ok: true, results };
}
