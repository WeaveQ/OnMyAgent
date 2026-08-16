/**
 * Managed child env + isolated OpenCode HOME/config.
 * Extracted from runtime.mjs (factory; re-used by createRuntimeManager).
 */
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  isComputerUseMcpEnabled,
  resolveComputerUseRuntimeCommand,
  writeComputerUseRuntimeConfig,
} from "./computer-use-runtime-config.mjs";
import {
  applyOpencodeSandboxEnv,
  linkHomeConfigOpencodeSkills,
  prepareOpencodeSandboxHome,
} from "./opencode-sandbox-home.mjs";
import { loadUserEnvFile, enrichedPath } from "./runtime-path-env.mjs";

/**
 * @param {{
 *   app: { getPath: (name: string) => string },
 *   userDataDir: string,
 *   resolvedHomeDir: string,
 *   desktopRoot: string,
 *   runtimeBinDirs: string[],
 *   sidecarDirs: string[],
 *   managedToolsBinRoot: string,
 *   runtimeEnvironment: () => NodeJS.ProcessEnv,
 *   prepareManagedOpencodeConfigDir: (configDir: string) => Promise<string>,
 *   onmyagentOpencodeConfigDir: () => string,
 * }} deps
 */
export function createRuntimeChildEnv({
  app,
  userDataDir,
  resolvedHomeDir,
  desktopRoot,
  runtimeBinDirs,
  sidecarDirs,
  managedToolsBinRoot,
  runtimeEnvironment,
  prepareManagedOpencodeConfigDir,
  onmyagentOpencodeConfigDir,
}) {
    function resolveLocalOpencodeConfigDir() {
      const explicit = process.env.OPENCODE_CONFIG_DIR?.trim();
      if (explicit) return explicit;

      const candidates = [
        path.join(app.getPath("home"), ".config", "opencode"),
        process.env.XDG_CONFIG_HOME?.trim()
          ? path.join(process.env.XDG_CONFIG_HOME.trim(), "opencode")
          : null,
        path.join(os.homedir(), ".config", "opencode"),
      ].filter(Boolean);

      for (const candidate of [...new Set(candidates)]) {
        if (existsSync(path.join(candidate, "opencode.json")) || existsSync(path.join(candidate, "opencode.jsonc"))) {
          return candidate;
        }
      }
      return null;
    }
    async function ensureDevModePaths() {
      const root = path.join(userDataDir, "onmyagent-dev-data");
      const paths = {
        homeDir: path.join(root, "home"),
        xdgConfigHome: path.join(root, "xdg", "config"),
        xdgDataHome: path.join(root, "xdg", "data"),
        xdgCacheHome: path.join(root, "xdg", "cache"),
        xdgStateHome: path.join(root, "xdg", "state"),
        opencodeConfigDir: path.join(root, "config", "opencode"),
      };

      for (const dir of Object.values(paths)) {
        await mkdir(dir, { recursive: true });
      }
      await mkdir(path.join(paths.xdgDataHome, "opencode"), { recursive: true });
      return paths;
    }

    async function buildChildEnv(extra = {}, options = {}) {
      /** @type {NodeJS.ProcessEnv} */
      // User env is layered first so process.env + any caller overrides always
      // win. See apps/server/src/services/env-file.ts; both loaders must agree
      // on path and reserved-keys policy.
      const env = {
        ...loadUserEnvFile(),
        ...process.env,
        BUN_CONFIG_DNS_RESULT_ORDER: "verbatim",
        ...runtimeEnvironment(),
        ...extra,
      };
      const pathKey =
        Object.prototype.hasOwnProperty.call(env, "PATH") ||
        !Object.prototype.hasOwnProperty.call(env, "Path")
          ? "PATH"
          : "Path";
      const pathEnv = enrichedPath(
        [...runtimeBinDirs, ...sidecarDirs],
        env[pathKey],
      );
      const pathEntries = String(pathEnv ?? "")
        .split(path.delimiter)
        .filter((entry) => entry && entry !== managedToolsBinRoot);
      env[pathKey] = [managedToolsBinRoot, ...pathEntries].join(path.delimiter);
      if (process.env.ONMYAGENT_DEV_MODE === "1") {
        const devPaths = await ensureDevModePaths();
        env.ONMYAGENT_DEV_MODE = "1";
        // Placeholders only; sandbox apply below overwrites HOME / XDG / config dir.
        env.HOME = env.HOME?.trim() ? env.HOME : devPaths.homeDir;
        env.USERPROFILE = env.USERPROFILE?.trim() ? env.USERPROFILE : devPaths.homeDir;
        env.XDG_CONFIG_HOME = env.XDG_CONFIG_HOME?.trim() ? env.XDG_CONFIG_HOME : devPaths.xdgConfigHome;
        env.XDG_DATA_HOME = env.XDG_DATA_HOME?.trim() ? env.XDG_DATA_HOME : devPaths.xdgDataHome;
        env.XDG_CACHE_HOME = env.XDG_CACHE_HOME?.trim() ? env.XDG_CACHE_HOME : devPaths.xdgCacheHome;
        env.XDG_STATE_HOME = env.XDG_STATE_HOME?.trim() ? env.XDG_STATE_HOME : devPaths.xdgStateHome;
        env.OPENCODE_TEST_HOME = env.OPENCODE_TEST_HOME?.trim() ? env.OPENCODE_TEST_HOME : devPaths.homeDir;
      }

      // Always stamp the real user home so in-process server features
      // (session-archive discovery of Claude/Codex/Grok/…) never scan the
      // OpenCode sandbox HOME after isolation below.
      env.ONMYAGENT_REAL_HOME = env.ONMYAGENT_REAL_HOME?.trim()
        ? env.ONMYAGENT_REAL_HOME
        : resolvedHomeDir;
      if (!process.env.ONMYAGENT_REAL_HOME?.trim()) {
        process.env.ONMYAGENT_REAL_HOME = resolvedHomeDir;
      }

      // Path B: isolate OpenCode from the real user HOME so ~/.opencode plugins
      // (Sisyphus) and ~/.claude|~/.agents skill catalogs never enter product
      // sessions. Providers/auth are mirrored into the sandbox.
      // Opt out: ONMYAGENT_OPENCODE_USE_REAL_HOME=1 (debug only).
      if (process.env.ONMYAGENT_OPENCODE_USE_REAL_HOME !== "1") {
        const sandbox = await prepareOpencodeSandboxHome({
          userDataDir,
          realHomeDir: resolvedHomeDir,
        });
        applyOpencodeSandboxEnv(env, sandbox);
      } else if (!env.OPENCODE_CONFIG_DIR?.trim()) {
        env.OPENCODE_CONFIG_DIR =
          resolveLocalOpencodeConfigDir() || onmyagentOpencodeConfigDir();
      }
      const configDir = env.OPENCODE_CONFIG_DIR?.trim() || onmyagentOpencodeConfigDir();
      env.OPENCODE_CONFIG_DIR = await prepareManagedOpencodeConfigDir(configDir);
      if (process.env.ONMYAGENT_OPENCODE_USE_REAL_HOME !== "1") {
        await linkHomeConfigOpencodeSkills({
          homeDir: env.HOME,
          configDir: env.OPENCODE_CONFIG_DIR,
        }).catch((error) => {
          console.warn("[runtime] Failed to expose core slash skills under sandbox HOME:", error);
        });
      }
      if (!env.OPENCODE_CONFIG?.trim()) {
        const computerUsePlatform = process.platform;
        const computerUseCommand = resolveComputerUseRuntimeCommand({
          platform: computerUsePlatform,
          desktopRoot,
          resourcesPath: process.resourcesPath,
          explicitBinary: process.env.ONMYAGENT_COMPUTER_USE_BINARY,
          devMode: process.env.ONMYAGENT_DEV_MODE === "1",
        });
        if (computerUseCommand) {
          env.OPENCODE_CONFIG = await writeComputerUseRuntimeConfig(
            env.OPENCODE_CONFIG_DIR,
            computerUseCommand,
            {
              enabled: isComputerUseMcpEnabled({
                platform: computerUsePlatform,
                userDataDir,
              }),
            },
          );
        }
      }
      return env;
    }

    // Normal OpenCode sessions and expert/detached sessions must inherit the
    // same managed-tool PATH and prepared OpenCode skill directory. Keep this
    // as the single runtime boundary so optional tools such as OfficeCLI are
    // available consistently in both session modes.
    async function resolveChildEnvironment(extra = {}, options = {}) {
      return buildChildEnv(extra, options);
    }

  return {
    resolveLocalOpencodeConfigDir,
    ensureDevModePaths,
    buildChildEnv,
    resolveChildEnvironment,
  };
}
