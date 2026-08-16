/**
 * Personal vault folder override. Index / session-defaults stay under
 * data/user/knowledge/; only the user-scope note directory can move.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import {
  resolveDefaultUserVaultDir,
  resolveKnowledgeConfigPath,
  resolveKnowledgeRoot,
} from "./knowledge-vault-paths.mjs";

/**
 * @param {unknown} raw
 * @param {string} [homeDir]
 * @returns {{ ok: true, path: string } | { ok: false, reason: string }}
 */
export function validatePersonalVaultPath(raw, homeDir) {
  const requested = String(raw ?? "").trim();
  if (!requested) return { ok: false, reason: "empty" };
  if (!path.isAbsolute(requested)) return { ok: false, reason: "not_absolute" };
  if (requested.includes("\0")) return { ok: false, reason: "invalid_path" };
  const abs = path.resolve(requested);
  const root = resolveKnowledgeRoot(homeDir);
  if (abs === path.resolve(root)) return { ok: false, reason: "reserved_root" };
  let st;
  try {
    st = statSync(abs);
  } catch {
    return { ok: false, reason: "not_found" };
  }
  if (!st.isDirectory()) return { ok: false, reason: "not_directory" };
  return { ok: true, path: abs };
}

/**
 * @param {string} dir
 */
export function personalVaultHasVisibleEntries(dir) {
  try {
    return readdirSync(dir).some((name) => name && !name.startsWith("."));
  } catch {
    return false;
  }
}

/**
 * @param {string} knowledgeRoot
 */
export function resolveUserVaultDirFromKnowledgeRoot(knowledgeRoot) {
  const defaultPath = path.join(knowledgeRoot, "vault");
  try {
    const parsed = JSON.parse(readFileSync(path.join(knowledgeRoot, "config.json"), "utf8"));
    const override = String(parsed?.personalVaultPath ?? "").trim();
    if (!override || !path.isAbsolute(override)) return defaultPath;
    const st = statSync(override);
    return st.isDirectory() ? override : defaultPath;
  } catch {
    return defaultPath;
  }
}

function folderLabel(dir) {
  return path.basename(dir) || dir;
}

function readRawConfig(homeDir) {
  try {
    return JSON.parse(readFileSync(resolveKnowledgeConfigPath(homeDir), "utf8"));
  } catch {
    return {};
  }
}

/**
 * @param {string} [homeDir]
 * @returns {Array<{ name: string, path: string, isDefault: boolean }>}
 */
export function listKnowledgeVaults(homeDir) {
  const defaultPath = resolveDefaultUserVaultDir(homeDir);
  const parsed = readRawConfig(homeDir);
  const seen = new Set([path.resolve(defaultPath)]);
  const vaults = [
    { name: folderLabel(defaultPath) === "vault" ? "OnMyAgent" : folderLabel(defaultPath), path: defaultPath, isDefault: true },
  ];
  const extra = Array.isArray(parsed.vaults) ? parsed.vaults : [];
  if (parsed.personalVaultPath) {
    extra.unshift({ name: folderLabel(String(parsed.personalVaultPath)), path: parsed.personalVaultPath });
  }
  for (const item of extra) {
    const checked = validatePersonalVaultPath(item?.path, homeDir);
    if (!checked.ok || seen.has(checked.path)) continue;
    seen.add(checked.path);
    vaults.push({
      name: String(item?.name ?? "").trim() || folderLabel(checked.path),
      path: checked.path,
      isDefault: false,
    });
  }
  return vaults;
}

export function readKnowledgeConfig(homeDir) {
  const defaultPath = resolveDefaultUserVaultDir(homeDir);
  const parsed = readRawConfig(homeDir);
  const override = String(parsed.personalVaultPath ?? "").trim();
  const vaults = listKnowledgeVaults(homeDir);
  if (!override) {
    return {
      personalVaultPath: null,
      resolvedUserVaultDir: defaultPath,
      usingDefault: true,
      vaults,
    };
  }
  const checked = validatePersonalVaultPath(override, homeDir);
  if (!checked.ok) {
    return {
      personalVaultPath: null,
      resolvedUserVaultDir: defaultPath,
      usingDefault: true,
      vaults,
    };
  }
  const usingDefault = checked.path === defaultPath;
  return {
    personalVaultPath: usingDefault ? null : checked.path,
    resolvedUserVaultDir: checked.path,
    usingDefault,
    vaults,
  };
}

/**
 * @param {string | null | undefined} nextPath
 * @param {string} [homeDir]
 */
export async function writePersonalVaultPath(nextPath, homeDir) {
  const defaultPath = resolveDefaultUserVaultDir(homeDir);
  const prev = readRawConfig(homeDir);
  const known = listKnowledgeVaults(homeDir)
    .filter((item) => !item.isDefault)
    .map((item) => ({ name: item.name, path: item.path }));
  if (nextPath == null || String(nextPath).trim() === "") {
    await persistConfig({ personalVaultPath: null, vaults: known }, homeDir);
    return { ok: true, ...readKnowledgeConfig(homeDir) };
  }
  const checked = validatePersonalVaultPath(nextPath, homeDir);
  if (checked.ok === false) {
    return { ok: false, reason: checked.reason, ...readKnowledgeConfig(homeDir) };
  }
  const usingDefault = checked.path === defaultPath;
  if (!usingDefault && !known.some((item) => item.path === checked.path)) {
    known.push({ name: folderLabel(checked.path), path: checked.path });
  }
  await persistConfig(
    {
      personalVaultPath: usingDefault ? null : checked.path,
      vaults: known,
      ...(prev && typeof prev === "object" ? {} : {}),
    },
    homeDir,
  );
  return { ok: true, ...readKnowledgeConfig(homeDir) };
}

/**
 * @param {{ personalVaultPath?: string | null, vaults?: Array<{ name?: string, path?: string }> }} config
 * @param {string} [homeDir]
 */
async function persistConfig(config, homeDir) {
  const filePath = resolveKnowledgeConfigPath(homeDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(tmp, filePath);
}
