/**
 * Managed HOME / XDG sandbox for the product OpenCode process.
 *
 * Real-user HOME pulls in ~/.opencode plugins (oh-my-openagent → Sisyphus) and
 * ~/.claude|~/.agents skill floods (~80–100k input tokens). Expert isolation
 * files alone are not enough while the serve process still uses real HOME.
 *
 * Dogfood (2026-08-10): sandbox HOME + providers-only config + agent onmyagent
 * brought expert first-turn input from ~78k–100k to ~4.8k with the full
 * kol-content-ops system prompt.
 */

import { existsSync } from "node:fs";
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const OPENCODE_SANDBOX_DIR_NAME = "opencode-sandbox";

/**
 * @param {string} userDataDir
 */
export function resolveOpencodeSandboxRoot(userDataDir) {
  return path.join(String(userDataDir ?? "").trim() || os.tmpdir(), OPENCODE_SANDBOX_DIR_NAME);
}

/**
 * @param {string} userDataDir
 */
export function resolveOpencodeSandboxPaths(userDataDir) {
  const root = resolveOpencodeSandboxRoot(userDataDir);
  return {
    root,
    homeDir: path.join(root, "home"),
    xdgConfigHome: path.join(root, "xdg", "config"),
    xdgDataHome: path.join(root, "xdg", "data"),
    xdgCacheHome: path.join(root, "xdg", "cache"),
    xdgStateHome: path.join(root, "xdg", "state"),
    opencodeConfigPath: path.join(root, "xdg", "config", "opencode", "opencode.json"),
    opencodeDataDir: path.join(root, "xdg", "data", "opencode"),
  };
}

/**
 * Build providers-only OpenCode config: keep model providers, drop plugins /
 * instructions that reintroduce home skill floods.
 * @param {unknown} source
 */
export function buildSandboxOpencodeConfig(source) {
  const base =
    source && typeof source === "object" && !Array.isArray(source)
      ? /** @type {Record<string, unknown>} */ ({ ...source })
      : {};
  const out = {
    $schema:
      typeof base.$schema === "string"
        ? base.$schema
        : "https://opencode.ai/config.json",
    plugin: [],
  };
  if (base.provider && typeof base.provider === "object") {
    out.provider = base.provider;
  }
  if (base.model && typeof base.model === "string") {
    out.model = base.model;
  }
  if (base.disabled_providers && Array.isArray(base.disabled_providers)) {
    out.disabled_providers = base.disabled_providers;
  }
  if (base.compaction && typeof base.compaction === "object") {
    out.compaction = base.compaction;
  }
  // Intentionally omit: plugin (forced empty), instructions, agent overrides
  // from home oh-my-openagent.
  return out;
}

/**
 * @param {{
 *   userDataDir: string,
 *   realHomeDir?: string,
 * }} input
 */
export async function prepareOpencodeSandboxHome(input) {
  const realHome = String(input.realHomeDir ?? os.homedir()).trim() || os.homedir();
  const paths = resolveOpencodeSandboxPaths(input.userDataDir);
  await Promise.all([
    mkdir(paths.homeDir, { recursive: true }),
    mkdir(path.dirname(paths.opencodeConfigPath), { recursive: true }),
    mkdir(paths.opencodeDataDir, { recursive: true }),
    mkdir(paths.xdgCacheHome, { recursive: true }),
    mkdir(paths.xdgStateHome, { recursive: true }),
  ]);

  const userConfigCandidates = [
    path.join(realHome, ".config", "opencode", "opencode.json"),
    path.join(realHome, ".config", "opencode", "opencode.jsonc"),
    path.join(realHome, ".opencode", "opencode.json"),
  ];
  let sourceConfig = {};
  for (const candidate of userConfigCandidates) {
    if (!existsSync(candidate)) continue;
    try {
      const raw = await readFile(candidate, "utf8");
      // jsonc may have comments — strip naive // and /* */ for best effort
      const stripped = raw
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      sourceConfig = JSON.parse(stripped);
      break;
    } catch {
      // try next
    }
  }

  const sandboxConfig = buildSandboxOpencodeConfig(sourceConfig);
  await writeFile(
    paths.opencodeConfigPath,
    `${JSON.stringify(sandboxConfig, null, 2)}\n`,
    "utf8",
  );

  // Provider auth (API keys stored by OpenCode outside opencode.json)
  const authSrc = path.join(realHome, ".local", "share", "opencode", "auth.json");
  const authDst = path.join(paths.opencodeDataDir, "auth.json");
  if (existsSync(authSrc)) {
    try {
      await copyFile(authSrc, authDst);
    } catch {
      // non-fatal: provider block may already embed apiKey
    }
  }

  return paths;
}

/**
 * Apply sandbox HOME/XDG env for the OpenCode child process.
 * @param {NodeJS.ProcessEnv} env
 * @param {Awaited<ReturnType<typeof prepareOpencodeSandboxHome>>} paths
 */
export function applyOpencodeSandboxEnv(env, paths) {
  // Preserve real home before overwriting — session-archive and other product
  // scanners must keep reading ~/.claude / ~/.codex / ~/.grok under the user.
  const realHome =
    env.ONMYAGENT_REAL_HOME?.trim() ||
    env.HOME?.trim() ||
    process.env.ONMYAGENT_REAL_HOME?.trim() ||
    "";
  if (realHome && !realHome.includes("opencode-sandbox")) {
    env.ONMYAGENT_REAL_HOME = realHome;
  }
  env.HOME = paths.homeDir;
  env.USERPROFILE = paths.homeDir;
  env.XDG_CONFIG_HOME = paths.xdgConfigHome;
  env.XDG_DATA_HOME = paths.xdgDataHome;
  env.XDG_CACHE_HOME = paths.xdgCacheHome;
  env.XDG_STATE_HOME = paths.xdgStateHome;
  // OPENCODE_TEST_HOME should not re-expand into the real user home.
  env.OPENCODE_TEST_HOME = paths.homeDir;
  return env;
}
