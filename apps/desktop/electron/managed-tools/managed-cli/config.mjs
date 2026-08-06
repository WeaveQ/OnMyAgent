/**
 * Shared download-config / registry loader for managed remote CLIs.
 *
 * Desktop ships one registry JSON (pluginId → permanent root manifestUrl).
 * Each plugin's remote root catalog holds version + asset/skill URLs for hot updates.
 *
 * Example registry:
 * {
 *   "schemaVersion": 1,
 *   "plugins": {
 *     "officecli": { "manifestUrl": "https://…/officecli/manifest.json" },
 *     "feishu-cli": { "manifestUrl": "https://…/feishu-cli/manifest.json" }
 *   }
 * }
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function nonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/** Default registry next to managed-tools/ (packaged in electron asar). */
export const MANAGED_CLI_DEFAULT_REGISTRY_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "managed-cli-registry.json",
);

/**
 * @param {string | null | undefined} customPath
 * @returns {string}
 */
export function resolveManagedCliRegistryPath(customPath) {
  const fromOption = nonEmptyString(customPath);
  if (fromOption) return fromOption;
  const fromEnv = nonEmptyString(process.env.ONMYAGENT_MANAGED_CLI_REGISTRY);
  if (fromEnv) return fromEnv;
  return MANAGED_CLI_DEFAULT_REGISTRY_PATH;
}

/**
 * @param {unknown} entry
 * @returns {{ url: string, archive: "raw" | "zip", entry: string | null } | null}
 */
export function parseManagedCliAssetSpec(entry) {
  if (typeof entry === "string") {
    const url = nonEmptyString(entry);
    if (!url) return null;
    return { url, archive: "raw", entry: null };
  }
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const record = /** @type {Record<string, unknown>} */ (entry);
  const url = nonEmptyString(record.url);
  if (!url) return null;
  const archive = record.archive === "zip" ? "zip" : "raw";
  const extractEntry = nonEmptyString(record.entry);
  if (archive === "zip" && !extractEntry) return null;
  return { url, archive, entry: extractEntry };
}

/**
 * Load the multi-plugin registry (pluginId → manifestUrl, …).
 *
 * @param {string | null | undefined} [registryPath]
 * @returns {{
 *   schemaVersion: number | null,
 *   plugins: Record<string, { manifestUrl: string | null }>,
 * }}
 */
export function loadManagedCliRegistry(registryPath) {
  const empty = { schemaVersion: null, plugins: {} };
  const resolvedPath = resolveManagedCliRegistryPath(registryPath);
  let raw;
  try {
    raw = readFileSync(resolvedPath, "utf8");
  } catch {
    return empty;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return empty;
  }

  const pluginsRaw =
    parsed.plugins && typeof parsed.plugins === "object" && !Array.isArray(parsed.plugins)
      ? parsed.plugins
      : {};
  /** @type {Record<string, { manifestUrl: string | null }>} */
  const plugins = Object.create(null);
  for (const [pluginId, entry] of Object.entries(pluginsRaw)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = /** @type {Record<string, unknown>} */ (entry);
    plugins[pluginId] = {
      manifestUrl: nonEmptyString(record.manifestUrl),
    };
  }

  const schemaVersion =
    typeof parsed.schemaVersion === "number" && Number.isFinite(parsed.schemaVersion)
      ? parsed.schemaVersion
      : null;

  return { schemaVersion, plugins };
}

/**
 * @param {string} pluginId
 * @param {string | null | undefined} [registryPath]
 * @returns {{ manifestUrl: string | null }}
 */
export function loadManagedCliPluginEntry(pluginId, registryPath) {
  const id = nonEmptyString(pluginId);
  if (!id) return { manifestUrl: null };
  const registry = loadManagedCliRegistry(registryPath);
  return registry.plugins[id] ?? { manifestUrl: null };
}

/**
 * Legacy single-plugin download-config shape (still useful in unit tests).
 *
 * @param {{
 *   configPath: string,
 *   assetKeys: readonly string[],
 * }} input
 * @returns {{
 *   version: string | null,
 *   manifestUrl: string | null,
 *   releaseManifestUrl: string | null,
 *   skillUrl: string | null,
 *   assets: Record<string, { url: string, archive: "raw" | "zip", entry: string | null }>,
 * }}
 */
export function loadManagedCliDownloadConfig(input) {
  const empty = {
    version: null,
    manifestUrl: null,
    releaseManifestUrl: null,
    skillUrl: null,
    assets: {},
  };
  let raw;
  try {
    raw = readFileSync(input.configPath, "utf8");
  } catch {
    return empty;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return empty;
  }

  // Registry shape: { plugins: { officecli: { manifestUrl } } }
  if (parsed.plugins && typeof parsed.plugins === "object") {
    return empty;
  }

  const assetsRaw =
    parsed.assets && typeof parsed.assets === "object" && !Array.isArray(parsed.assets)
      ? parsed.assets
      : {};
  /** @type {Record<string, { url: string, archive: "raw" | "zip", entry: string | null }>} */
  const assets = Object.create(null);
  for (const key of input.assetKeys) {
    const spec = parseManagedCliAssetSpec(assetsRaw[key]);
    if (spec) assets[key] = spec;
  }

  return {
    version: nonEmptyString(parsed.version),
    manifestUrl: nonEmptyString(parsed.manifestUrl),
    releaseManifestUrl: nonEmptyString(parsed.releaseManifestUrl),
    skillUrl: nonEmptyString(parsed.skillUrl),
    assets,
  };
}
