/**
 * Single directory walk for vault list, FTS, and knowledge_search.
 * Copied next to the OpenCode plugin on install so the tool uses this file.
 */
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export const WALK_INDEXABLE_EXTENSIONS = Object.freeze([".md", ".txt", ".csv"]);
export const WALK_MAX_BYTES = 1_000_000;

export function walkFileExtension(relPath) {
  const base = path.posix.basename(String(relPath ?? ""));
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot).toLowerCase();
}

export function isWalkIndexableRelPath(relPath) {
  return WALK_INDEXABLE_EXTENSIONS.includes(walkFileExtension(relPath));
}

export function isWalkHiddenName(name) {
  const base = String(name ?? "").trim();
  return !base || base.startsWith(".") || base === "index.sqlite";
}

/**
 * @param {string} dir
 * @param {{ includeNonIndexable?: boolean, maxBytes?: number, prefix?: string }} [options]
 * @returns {Promise<Array<{
 *   abs: string,
 *   relPath: string,
 *   name: string,
 *   size: number,
 *   mtimeMs: number,
 *   indexable: boolean,
 * }>>}
 */
export async function walkKnowledgeTree(dir, options = {}) {
  const includeNonIndexable = options.includeNonIndexable === true;
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : WALK_MAX_BYTES;
  const prefix = String(options.prefix ?? "");

  const names = await readdir(dir).catch(() => []);
  const files = [];
  for (const name of names) {
    if (isWalkHiddenName(name)) continue;
    const abs = path.join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    let st;
    try {
      st = await stat(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      files.push(
        ...(await walkKnowledgeTree(abs, {
          includeNonIndexable,
          maxBytes,
          prefix: rel,
        })),
      );
      continue;
    }
    if (!st.isFile()) continue;
    const relPath = rel.replace(/\\/g, "/");
    const indexable = isWalkIndexableRelPath(relPath) && st.size <= maxBytes;
    if (!indexable && !includeNonIndexable) continue;
    files.push({
      abs,
      relPath,
      name,
      size: st.size,
      mtimeMs: st.mtimeMs,
      indexable,
    });
  }
  return files.sort((a, b) => a.relPath.localeCompare(b.relPath));
}
