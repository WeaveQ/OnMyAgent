/**
 * Shared download-config loader for managed remote CLIs.
 *
 * Config is the version pin + permanent asset URLs (CDN object keys are immutable).
 * Updating a CLI means shipping a new config JSON in a desktop release — there is
 * no root "latest" pointer that can swap content behind a stable URL.
 *
 * Example (OfficeCLI):
 * {
 *   "version": "1.0.143",
 *   "releaseManifestUrl": "https://…/manifest.json",
 *   "skillUrl": "https://…/SKILL.md",
 *   "assets": {
 *     "officecli-mac-arm64": {
 *       "url": "https://…/officecli_mac_arm64.zip",
 *       "archive": "zip",
 *       "entry": "officecli-mac-arm64"
 *     }
 *   }
 * }
 */
import { readFileSync } from "node:fs";

/**
 * @param {unknown} value
 * @returns {string | null}
 */
export function nonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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
