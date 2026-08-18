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
import { copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { linkOrCopyDir } from "./runtime-dir-mirror.mjs";
import { ensureKnowledgeVault } from "./ensure-knowledge-vault.mjs";
import {
  applyKnowledgeSearchEnv,
  installKnowledgeSearchPlugin,
  readKnowledgeSessionDefaultsSync,
} from "./knowledge-search-plugin.mjs";

/**
 * OpenCode 1.18 skill tool scans `~/.config/opencode/skills` via $HOME, not
 * XDG_CONFIG_HOME / OPENCODE_CONFIG_DIR. Only expose the small create/slash
 * core there so Expert sessions do not reload the whole profile catalog.
 */
export const HOME_CONFIG_SLASH_SKILL_NAMES = Object.freeze([
  "skill-creator",
  "expert-manager",
  "find-skills",
  "create-automation",
  "knowledge-vault",
]);

export const OPENCODE_SANDBOX_DIR_NAME = "opencode-sandbox";

/**
 * OpenCode starts a background dependency reconcile for every config
 * directory. Managed sandboxes only use product-owned local plugins, so an
 * empty node_modules plus a lockfile entry prevents that reconcile from
 * reaching the network (and retrying forever when offline).
 *
 * @param {string} configDir
 */
async function ensureLocalPluginDependencyState(configDir) {
  const root = String(configDir ?? "").trim();
  if (!root) return;
  const nodeModules = path.join(root, "node_modules");
  const packageJson = path.join(root, "package.json");
  const packageLock = path.join(root, "package-lock.json");
  await mkdir(nodeModules, { recursive: true });
  if (!existsSync(packageJson)) {
    await writeFile(
      packageJson,
      `${JSON.stringify({ private: true, dependencies: { "@opencode-ai/plugin": "*" } }, null, 2)}\n`,
      "utf8",
    );
  }
  if (!existsSync(packageLock)) {
    await writeFile(
      packageLock,
      `${JSON.stringify(
        {
          name: "onmyagent-opencode-sandbox",
          private: true,
          lockfileVersion: 3,
          requires: true,
          packages: {
            "": { dependencies: { "@opencode-ai/plugin": "*" } },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }
}

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
 *   installKnowledgePlugins?: boolean,
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
  await ensureLocalPluginDependencyState(path.dirname(paths.opencodeConfigPath));
  if (input.installKnowledgePlugins !== false) {
    try {
      await ensureKnowledgeVault({ homeDir: realHome });
      const installed = await installKnowledgeSearchPlugin({
        configDir: path.dirname(paths.opencodeConfigPath),
        homeDir: realHome,
      });
      if (installed.ok) {
        const pluginPaths = Array.isArray(installed.pluginPaths) && installed.pluginPaths.length
          ? installed.pluginPaths
          : installed.pluginPath
            ? [installed.pluginPath]
            : [];
        if (pluginPaths.length) sandboxConfig.plugin = pluginPaths;
      }
    } catch (error) {
      console.warn("[knowledge] install knowledge_search plugin failed", error);
    }
  }
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

export function sandboxOpencodeConfigDir(paths) {
  return path.dirname(paths.opencodeConfigPath);
}

export function pathIsInsideRoot(target, root) {
  const resolvedTarget = path.resolve(String(target ?? ""));
  const resolvedRoot = path.resolve(String(root ?? ""));
  if (!resolvedTarget || !resolvedRoot) return false;
  return (
    resolvedTarget === resolvedRoot ||
    resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)
  );
}

/** Drop inherited overlays that point back at the real user home. */
export function shouldKeepOpenCodeConfigOverlay(configPath, sandboxRoot) {
  const overlay = String(configPath ?? "").trim();
  if (!overlay) return false;
  return pathIsInsideRoot(overlay, sandboxRoot);
}

/**
 * Apply sandbox HOME/XDG env for the OpenCode child process.
 * @param {NodeJS.ProcessEnv} env
 * @param {Awaited<ReturnType<typeof prepareOpencodeSandboxHome>>} paths
 */
/**
 * Mirror core slash skills into `$HOME/.config/opencode/skills` after the
 * managed config dir has been prepared. Assistant `/skill-creator` lives here.
 *
 * @param {{ homeDir?: string | null, configDir?: string | null }} input
 */
export async function linkHomeConfigOpencodeSkills(input) {
  const homeDir = String(input.homeDir ?? "").trim();
  const configDir = String(input.configDir ?? "").trim();
  if (!homeDir || !configDir) return { linked: [] };
  const sourceRoot = path.join(configDir, "skills");
  const targetRoot = path.join(homeDir, ".config", "opencode", "skills");
  await mkdir(targetRoot, { recursive: true });
  const linked = [];
  for (const name of HOME_CONFIG_SLASH_SKILL_NAMES) {
    const source = path.join(sourceRoot, name);
    if (!existsSync(path.join(source, "SKILL.md"))) continue;
    const target = path.join(targetRoot, name);
    await rm(target, { recursive: true, force: true });
    await linkOrCopyDir(source, target);
    linked.push(name);
  }
  return { linked };
}

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
  env.OPENCODE_CONFIG_DIR = sandboxOpencodeConfigDir(paths);
  if (!shouldKeepOpenCodeConfigOverlay(env.OPENCODE_CONFIG, paths.root)) {
    delete env.OPENCODE_CONFIG;
  }
  const realHomeForKnowledge = env.ONMYAGENT_REAL_HOME?.trim() || "";
  if (realHomeForKnowledge && !realHomeForKnowledge.includes("opencode-sandbox")) {
    applyKnowledgeSearchEnv(env, readKnowledgeSessionDefaultsSync(realHomeForKnowledge));
  }
  return env;
}
