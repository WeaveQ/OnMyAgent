/**
 * Local "recently accessed" list for the knowledge vault.
 *
 * Pure reducers live here so they can be unit-tested without Electron;
 * the JSON file helpers are the only I/O and stay injectable via homeDir.
 *
 * Storage: <homeDir>/.onmyagent/knowledge/recent.json
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const RECENT_MAX_ENTRIES = 100;

/**
 * @param {string} homeDir
 */
export function resolveRecentFilePath(homeDir) {
  return path.join(String(homeDir), ".onmyagent", "knowledge", "recent.json");
}

/**
 * Display name for a note relPath: strip trailing `.md`/`.markdown`,
 * take the basename. Non-markdown files keep their extension.
 * @param {string} relPath
 * @returns {string}
 */
export function recentDisplayName(relPath) {
  const base = path.basename(String(relPath ?? "")).replace(/\\/g, "/").split("/").pop() ?? "";
  return base.replace(/\.(md|markdown)$/i, "");
}

/**
 * @param {{ scope: string, relPath: string }} ref
 * @returns {string}
 */
export function recentEntryKey({ scope, relPath }) {
  return `${String(scope)}:${String(relPath)}`;
}

function toArray(entries) {
  if (Array.isArray(entries)) return entries;
  if (entries && typeof entries === "object") {
    return Object.values(entries).filter((item) => item && typeof item === "object");
  }
  return [];
}

/**
 * Record one access. Dedupes by key, bumps to front, caps at RECENT_MAX_ENTRIES.
 *
 * @param {unknown} entries
 * @param {{ scope: string, relPath: string, vaultLabel?: string, now?: number | Date }} access
 * @returns {Array<{ key: string, scope: string, relPath: string, name: string, location: string, accessedAt: string }>}
 */
export function recordRecentAccess(entries, access) {
  const raw = access && typeof access === "object" ? access : {};
  const scope = String(raw.scope ?? "");
  const relPath = String(raw.relPath ?? "");
  const vaultLabel = raw.vaultLabel;
  const now = raw.now;
  const key = recentEntryKey({ scope, relPath });
  const accessedAt = new Date(now ?? Date.now()).toISOString();
  const name = recentDisplayName(relPath);
  const location = String(vaultLabel ?? "");
  const next = { key, scope: String(scope), relPath: String(relPath), name, location, accessedAt };

  const kept = toArray(entries).filter((item) => item && item.key !== key);
  return [next, ...kept].slice(0, RECENT_MAX_ENTRIES);
}

/**
 * Newest first by accessedAt (ISO strings sort lexicographically).
 * @param {unknown} entries
 */
export function sortRecentEntries(entries) {
  return toArray(entries).slice().sort((a, b) => {
    const ta = Date.parse(a?.accessedAt ?? 0) || 0;
    const tb = Date.parse(b?.accessedAt ?? 0) || 0;
    return tb - ta;
  });
}

/**
 * Drop entries whose backing file no longer exists.
 * @param {unknown} entries
 * @param {(scope: string, relPath: string) => boolean} exists
 */
export function pruneRecentEntries(entries, exists) {
  if (typeof exists !== "function") return toArray(entries);
  return toArray(entries).filter((item) => {
    if (!item || typeof item.scope !== "string" || typeof item.relPath !== "string") return false;
    return !!exists(item.scope, item.relPath);
  });
}

/**
 * @param {string} homeDir
 * @returns {Promise<Array<object>>}
 */
export async function readRecentFile(homeDir) {
  const filePath = resolveRecentFilePath(homeDir);
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    const arr = toArray(parsed);
    return arr.filter((item) => item && typeof item.key === "string");
  } catch {
    return [];
  }
}

/**
 * Atomic-ish write: tmp file then rename. Creates parent dir.
 * @param {string} homeDir
 * @param {unknown} entries
 */
export async function writeRecentFile(homeDir, entries) {
  const filePath = resolveRecentFilePath(homeDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  const payload = JSON.stringify(sortRecentEntries(entries).slice(0, RECENT_MAX_ENTRIES), null, 2);
  await writeFile(tmp, `${payload}\n`, "utf8");
  await rename(tmp, filePath);
  return { ok: true, path: filePath };
}
