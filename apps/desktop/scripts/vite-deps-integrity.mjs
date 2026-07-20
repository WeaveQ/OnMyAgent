/**
 * Vite optimize-deps integrity helpers for desktop dev.
 *
 * A common blank-window failure: Electron keeps a stale HTTP/Code Cache that
 * still imports chunk-*.js files removed after a partial optimize-deps rewrite.
 * These helpers detect broken on-disk graphs and clear the caches that make
 * the renderer keep requesting dead chunks.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const CHUNK_IMPORT_RE = /(?:from|import)\s*["']\.\/(chunk-[A-Za-z0-9_-]+\.js)["']|["']\.\/(chunk-[A-Za-z0-9_-]+\.js)["']/g;

/**
 * @param {string} depsDir absolute path to apps/app/node_modules/.vite/deps
 * @returns {{
 *   depsDir: string,
 *   exists: boolean,
 *   ok: boolean,
 *   browserHash: string | null,
 *   optimizedCount: number,
 *   brokenImports: Array<{ from: string, to: string }>,
 *   optimizedMissing: Array<{ id: string, file: string }>,
 *   reason: string | null,
 * }}
 */
export function inspectViteDeps(depsDir) {
  const absolute = resolve(depsDir);
  const result = {
    depsDir: absolute,
    exists: false,
    ok: false,
    browserHash: null,
    optimizedCount: 0,
    brokenImports: [],
    optimizedMissing: [],
    reason: null,
  };

  if (!existsSync(absolute)) {
    result.reason = "deps_dir_missing";
    return result;
  }
  result.exists = true;

  const metadataPath = join(absolute, "_metadata.json");
  if (!existsSync(metadataPath)) {
    result.reason = "metadata_missing";
    return result;
  }

  let metadata;
  try {
    metadata = JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch {
    result.reason = "metadata_unreadable";
    return result;
  }

  result.browserHash =
    typeof metadata.browserHash === "string" ? metadata.browserHash : null;
  const optimized =
    metadata && typeof metadata.optimized === "object" && metadata.optimized
      ? metadata.optimized
      : {};
  result.optimizedCount = Object.keys(optimized).length;

  const files = new Set(readdirSync(absolute));

  for (const [id, entry] of Object.entries(optimized)) {
    const file = entry && typeof entry.file === "string" ? entry.file : null;
    if (!file) continue;
    if (!files.has(file)) {
      result.optimizedMissing.push({ id, file });
    }
  }

  for (const name of files) {
    if (!name.endsWith(".js")) continue;
    let text = "";
    try {
      text = readFileSync(join(absolute, name), "utf8");
    } catch {
      continue;
    }
    CHUNK_IMPORT_RE.lastIndex = 0;
    let match;
    while ((match = CHUNK_IMPORT_RE.exec(text)) !== null) {
      const to = match[1] || match[2];
      if (to && !files.has(to)) {
        result.brokenImports.push({ from: name, to });
      }
    }
  }

  if (result.optimizedMissing.length > 0) {
    result.reason = "optimized_entry_missing";
    result.ok = false;
    return result;
  }
  if (result.brokenImports.length > 0) {
    result.reason = "broken_chunk_import";
    result.ok = false;
    return result;
  }
  if (result.optimizedCount === 0) {
    // Empty optimized graph is not necessarily broken (cold start before first
    // request), but it is not ready for a first paint either.
    result.reason = "optimized_empty";
    result.ok = false;
    return result;
  }

  result.ok = true;
  result.reason = null;
  return result;
}

/**
 * Resolve the default Vite deps directory for the monorepo app package.
 * @param {string} repoRoot
 */
export function resolveAppViteDepsDir(repoRoot) {
  return resolve(repoRoot, "apps/app/node_modules/.vite/deps");
}

/**
 * Resolve the default Vite cache root (parent of deps).
 * @param {string} repoRoot
 */
export function resolveAppViteCacheDir(repoRoot) {
  return resolve(repoRoot, "apps/app/node_modules/.vite");
}

/**
 * Remove the Vite optimize-deps cache so the next `vite --force` rebuilds cleanly.
 * @param {string} viteCacheDir e.g. apps/app/node_modules/.vite
 * @returns {{ cleared: boolean, path: string }}
 */
export function clearViteDepsCache(viteCacheDir) {
  const absolute = resolve(viteCacheDir);
  if (!existsSync(absolute)) {
    return { cleared: false, path: absolute };
  }
  rmSync(absolute, { recursive: true, force: true });
  return { cleared: true, path: absolute };
}

/**
 * Electron HTTP / Code caches that can keep requesting deleted Vite chunk files
 * after a re-optimize (same browserHash, new chunk names).
 */
export const ELECTRON_DEV_CACHE_DIR_NAMES = [
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
];

/**
 * @param {string} userDataDir Electron userData (e.g. .../com.differentai.onmyagent.dev)
 * @returns {{ cleared: string[], path: string }}
 */
export function clearElectronDevHttpCaches(userDataDir) {
  const absolute = resolve(userDataDir);
  const cleared = [];
  if (!existsSync(absolute)) {
    return { cleared, path: absolute };
  }
  for (const name of ELECTRON_DEV_CACHE_DIR_NAMES) {
    const target = join(absolute, name);
    if (!existsSync(target)) continue;
    try {
      rmSync(target, { recursive: true, force: true });
      cleared.push(name);
    } catch {
      // Best-effort: Electron may hold locks on some files mid-run.
    }
  }
  return { cleared, path: absolute };
}

/**
 * Resolve the default Electron userData directory for OnMyAgent desktop.
 * Mirrors apps/desktop/electron/main.mjs APP_IDENTIFIER selection.
 * @param {{ appData?: string, isDevMode?: boolean, override?: string | null }} [options]
 */
export function resolveOnMyAgentUserDataDir(options = {}) {
  const override = options.override?.trim();
  if (override) return resolve(override);

  const appData =
    options.appData?.trim() ||
    process.env.ONMYAGENT_ELECTRON_APPDATA?.trim() ||
    (process.platform === "darwin"
      ? join(process.env.HOME ?? "", "Library", "Application Support")
      : process.platform === "win32"
        ? process.env.APPDATA ?? join(process.env.HOME ?? "", "AppData", "Roaming")
        : join(process.env.HOME ?? process.env.XDG_CONFIG_HOME ?? "", ".config"));

  const isDevMode = options.isDevMode !== false;
  const identifier = isDevMode
    ? "com.differentai.onmyagent.dev"
    : "com.differentai.onmyagent";
  return join(appData, identifier);
}

/**
 * Decide whether electron-dev should force Vite optimize-deps rebuild.
 * @param {{ inspection: ReturnType<typeof inspectViteDeps>, forceEnv?: string | null }} input
 */
export function shouldForceViteOptimize(input) {
  const forceEnv = String(input.forceEnv ?? "").trim();
  if (forceEnv === "1" || forceEnv.toLowerCase() === "true") return true;
  if (!input.inspection?.ok) return true;
  return false;
}
