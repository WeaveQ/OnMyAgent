/**
 * Config profile paths + dual-read resolve for local (and later company).
 * SoT: docs/design/2026-08-02-config-consistency.md
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG_SCHEMA_VERSION = 1;

/** @param {string | undefined} homeDir */
export function normalizeOnMyAgentHome(homeDir) {
  const home = String(homeDir ?? os.homedir()).trim() || os.homedir();
  return home;
}

/** @param {string | undefined} homeDir */
export function resolveLocalConfigRoot(homeDir) {
  return path.join(
    normalizeOnMyAgentHome(homeDir),
    ".onmyagent",
    "profiles",
    "local",
    "config",
  );
}

/**
 * Company profile config root (created only after login + pull — never while logged out).
 * @param {string | undefined} homeDir
 */
export function resolveCompanyConfigRoot(homeDir) {
  return path.join(
    normalizeOnMyAgentHome(homeDir),
    ".onmyagent",
    "profiles",
    "company",
    "config",
  );
}

/**
 * Desktop company shell settings (BaseUrl / activeProfile / session meta).
 * @param {string | undefined} homeDir
 */
export function resolveCompanySettingsPath(homeDir) {
  return path.join(
    normalizeOnMyAgentHome(homeDir),
    ".onmyagent",
    "company-settings.json",
  );
}

/** @param {string | undefined} homeDir */
export function resolveLocalConfigManifestPath(homeDir) {
  return path.join(resolveLocalConfigRoot(homeDir), "manifest.json");
}

/** @param {string | undefined} homeDir */
export function resolveLocalSkillsProfilePath(homeDir) {
  return path.join(resolveLocalConfigRoot(homeDir), "skills");
}

/** @param {string | undefined} homeDir */
export function resolveLocalManagedToolsRoot(homeDir) {
  return path.join(
    normalizeOnMyAgentHome(homeDir),
    ".onmyagent",
    "profiles",
    "local",
    "tools",
  );
}

/** @param {string | undefined} homeDir */
export function resolveLocalManagedToolsBinRoot(homeDir) {
  return path.join(resolveLocalManagedToolsRoot(homeDir), "bin");
}

/** @param {string | undefined} homeDir */
export function resolveOfficeCliManagedRoot(homeDir) {
  return path.join(resolveLocalManagedToolsRoot(homeDir), "officecli");
}

/** @param {string | undefined} homeDir */
export function resolveLegacySkillsPath(homeDir) {
  return path.join(normalizeOnMyAgentHome(homeDir), ".onmyagent", "skills");
}

/**
 * @param {string | undefined} homeDir
 * @param {"experts" | "my-experts"} marketplace
 */
export function resolveLocalExpertsProfilePath(homeDir, marketplace) {
  const root = path.join(resolveLocalConfigRoot(homeDir), "experts");
  if (marketplace === "my-experts") return path.join(root, "mine");
  return path.join(root, "installed");
}

/**
 * @param {string | undefined} homeDir
 * @param {"experts" | "my-experts"} marketplace
 */
export function resolveLegacyExpertsPath(homeDir, marketplace) {
  const name = marketplace === "my-experts" ? "my-experts" : "experts";
  return path.join(
    normalizeOnMyAgentHome(homeDir),
    ".onmyagent",
    "marketplaces",
    name,
  );
}

/**
 * @param {string | undefined} homeDir
 * @param {{ readFileSync?: typeof readFileSync }} [io]
 * @returns {"absent" | "pending" | "complete" | "failed"}
 */
export function readLocalConfigMigrationStatus(homeDir, io = {}) {
  const read = io.readFileSync ?? readFileSync;
  const manifestPath = resolveLocalConfigManifestPath(homeDir);
  try {
    const raw = read(manifestPath, "utf8");
    const parsed = JSON.parse(String(raw));
    const status = String(parsed?.migration?.status ?? "").trim();
    if (status === "complete" || status === "pending" || status === "failed") {
      return status;
    }
    return "absent";
  } catch {
    return "absent";
  }
}

/** @param {string} dir */
export function dirNonEmpty(dir) {
  try {
    if (!existsSync(dir)) return false;
    if (!statSync(dir).isDirectory()) return false;
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * Skills root for install + list.
 * Product model: only profiles/local/config/skills (no ~/.onmyagent/skills dual-read).
 * @param {string | undefined} homeDir
 * @param {{ readFileSync?: typeof readFileSync }} [_io] unused; kept for call-site parity
 */
export function resolveLocalSkillsRoot(homeDir, _io = {}) {
  void _io;
  return resolveLocalSkillsProfilePath(homeDir);
}

/**
 * Experts marketplace root (installed vs mine).
 * @param {string | undefined} homeDir
 * @param {"experts" | "my-experts"} marketplace
 * @param {{ readFileSync?: typeof readFileSync }} [io]
 */
export function resolveLocalExpertsRoot(homeDir, marketplace, io = {}) {
  const profile = resolveLocalExpertsProfilePath(homeDir, marketplace);
  const legacy = resolveLegacyExpertsPath(homeDir, marketplace);
  const status = readLocalConfigMigrationStatus(homeDir, io);
  if (status === "complete") return profile;
  if (dirNonEmpty(profile)) return profile;
  return legacy;
}
