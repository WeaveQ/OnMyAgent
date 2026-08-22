/**
 * Seed OpenCode 1.18.18's models cache before the sidecar starts.
 * Pin uses `models.json` when OPENCODE_MODELS_URL is unset (default
 * models.opencode.ai). Also stamp OPENCODE_MODELS_PATH so a hashed
 * URL cannot ignore this file.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

export const OPENCODE_MODELS_CACHE_RELATIVE = path.join("opencode", "models.json");
export const BUNDLED_OPENCODE_MODELS_SNAPSHOT = "models.json.gz";

/**
 * @param {{
 *   snapshotPath?: string | null,
 *   resourcesPath?: string | null,
 * }} [input]
 */
export function resolveBundledOpencodeModelsSnapshot(input = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    typeof input.snapshotPath === "string" ? input.snapshotPath.trim() : "",
    path.resolve(here, "../resources/opencode-models", BUNDLED_OPENCODE_MODELS_SNAPSHOT),
    path.join(String(input.resourcesPath ?? process.resourcesPath ?? "").trim(), "opencode-models", BUNDLED_OPENCODE_MODELS_SNAPSHOT),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * @param {string} xdgCacheHome
 */
export function resolveOpencodeModelsCachePath(xdgCacheHome) {
  return path.join(String(xdgCacheHome ?? "").trim(), OPENCODE_MODELS_CACHE_RELATIVE);
}

/**
 * Write the bundled snapshot only when the cache file is missing or empty.
 * Never overwrites a populated cache OpenCode already fetched.
 *
 * @param {{
 *   xdgCacheHome: string,
 *   snapshotPath?: string | null,
 *   resourcesPath?: string | null,
 * }} input
 */
export async function seedOpencodeModelsCache(input) {
  const xdgCacheHome = String(input?.xdgCacheHome ?? "").trim();
  if (!xdgCacheHome) {
    return { seeded: false, reason: "no-cache-home" };
  }
  const dest = resolveOpencodeModelsCachePath(xdgCacheHome);
  try {
    const existing = await stat(dest);
    if (existing.isFile() && existing.size > 0) {
      return { seeded: false, reason: "exists", dest };
    }
  } catch {
    // missing is the first-launch path
  }

  const snapshotPath = resolveBundledOpencodeModelsSnapshot({
    snapshotPath: input.snapshotPath,
    resourcesPath: input.resourcesPath,
  });
  if (!snapshotPath) {
    return { seeded: false, reason: "no-snapshot", dest };
  }

  const gzipped = await readFile(snapshotPath);
  const json = gunzipSync(gzipped);
  JSON.parse(json.toString("utf8"));
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  await writeFile(tmp, json);
  await rename(tmp, dest);
  return { seeded: true, dest, snapshotPath };
}
