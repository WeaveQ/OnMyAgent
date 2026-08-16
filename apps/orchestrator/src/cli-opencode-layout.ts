/**
 * OpenCode state layout + messaging/router enablement.
 * Extracted from cli-shared.ts (mechanical split; re-exported for compat).
 */
import { copyFile, cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { readBool, readOptionalBool } from "./cli-args.js";
import type { Logger } from "./cli-logging.js";
import { fileExists, isDir } from "./cli-fs.js";
import { resolveLocalOpencodeConfigDir } from "./cli-version.js";
import type { OpencodeStateLayout } from "./cli-types.js";

export const ONMYAGENT_DEV_DATA_DIR = "onmyagent-dev-data";

export function resolveWorkspaceOnMyAgentConfigPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".opencode", "onmyagent.json");
}

export function resolveOpencodeRouterConfigPath(): string {
  const override = process.env.OPENCODE_ROUTER_CONFIG_PATH?.trim();
  if (override) return resolve(override.replace(/^~\//, `${homedir()}/`));
  const dataDir =
    process.env.OPENCODE_ROUTER_DATA_DIR?.trim() ||
    join(homedir(), ".onmyagent", "opencode-router");
  const expanded = dataDir.replace(/^~\//, `${homedir()}/`);
  return join(resolve(expanded), "opencode-router.json");
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readMessagingEnabledFromOnMyAgentConfig(
  onmyagentConfig: Record<string, unknown>,
): boolean | undefined {
  const messaging = asRecord(onmyagentConfig.messaging);
  return readOptionalBool(messaging.enabled);
}

export function hasConfiguredMessagingServices(routerConfig: Record<string, unknown>): boolean {
  const channels = asRecord(routerConfig.channels);

  const telegram = asRecord(channels.telegram);
  const legacyTelegramToken =
    typeof telegram.token === "string" ? telegram.token.trim() : "";
  if (legacyTelegramToken) return true;
  const telegramBots = Array.isArray(telegram.bots) ? telegram.bots : [];
  if (
    telegramBots.some((bot) => {
      const record = asRecord(bot);
      return (
        typeof record.token === "string" && record.token.trim().length > 0
      );
    })
  ) {
    return true;
  }

  const slack = asRecord(channels.slack);
  const legacySlackBotToken =
    typeof slack.botToken === "string" ? slack.botToken.trim() : "";
  const legacySlackAppToken =
    typeof slack.appToken === "string" ? slack.appToken.trim() : "";
  if (legacySlackBotToken && legacySlackAppToken) return true;
  const slackApps = Array.isArray(slack.apps) ? slack.apps : [];
  if (
    slackApps.some((app) => {
      const record = asRecord(app);
      const botToken =
        typeof record.botToken === "string" ? record.botToken.trim() : "";
      const appToken =
        typeof record.appToken === "string" ? record.appToken.trim() : "";
      return Boolean(botToken && appToken);
    })
  ) {
    return true;
  }

  return false;
}

export async function resolveOpencodeRouterEnabled(
  flags: Map<string, string | boolean>,
  workspaceRoot: string,
  logger: Logger,
): Promise<{
  enabled: boolean;
  source: "flag" | "env" | "workspace-config" | "inferred";
}> {
  const flagValue = flags.get("opencode-router");
  const parsedFlag = readOptionalBool(flagValue);
  if (parsedFlag !== undefined) {
    return { enabled: parsedFlag, source: "flag" };
  }

  const envValue = readOptionalBool(
    process.env.ONMYAGENT_OPENCODE_ROUTER,
  );
  if (envValue !== undefined) {
    return { enabled: envValue, source: "env" };
  }

  const onmyagentConfigPath = resolveWorkspaceOnMyAgentConfigPath(workspaceRoot);
  let onmyagentConfig: Record<string, unknown> = {};
  try {
    const raw = await readFile(onmyagentConfigPath, "utf8");
    onmyagentConfig = asRecord(JSON.parse(raw));
  } catch {
    onmyagentConfig = {};
  }

  const configured = readMessagingEnabledFromOnMyAgentConfig(onmyagentConfig);
  if (configured !== undefined) {
    return { enabled: configured, source: "workspace-config" };
  }

  let inferredEnabled = false;
  const routerConfigPath = resolveOpencodeRouterConfigPath();
  try {
    const raw = await readFile(routerConfigPath, "utf8");
    inferredEnabled = hasConfiguredMessagingServices(asRecord(JSON.parse(raw)));
  } catch {
    inferredEnabled = false;
  }

  const nextOnMyAgentConfig: Record<string, unknown> = {
    ...onmyagentConfig,
    messaging: {
      ...asRecord(onmyagentConfig.messaging),
      enabled: inferredEnabled,
    },
  };

  try {
    await mkdir(dirname(onmyagentConfigPath), { recursive: true });
    await writeFile(
      onmyagentConfigPath,
      `${JSON.stringify(nextOnMyAgentConfig, null, 2)}\n`,
      "utf8",
    );
  } catch (error) {
    logger.warn(
      "Failed to persist messaging enabled default",
      {
        path: onmyagentConfigPath,
        error: error instanceof Error ? error.message : String(error),
      },
      "onmyagent-orchestrator",
    );
  }

  return { enabled: inferredEnabled, source: "inferred" };
}

export function resolveInternalDevMode(flags: Map<string, string | boolean>): boolean {
  return readBool(flags, "internal-dev-mode", false, "ONMYAGENT_DEV_MODE");
}

export function internalDevModeFromEnv(): boolean {
  const value = process.env.ONMYAGENT_DEV_MODE?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export async function resolveOpencodeStateLayout(options: {
  dataDir: string;
  workspace: string;
  devMode: boolean;
}): Promise<OpencodeStateLayout> {
  const localConfigDir = await resolveLocalOpencodeConfigDir();
  if (!options.devMode) {
    const configDir = localConfigDir ?? join(options.dataDir, "opencode-config");
    return {
      devMode: false,
      rootDir: configDir,
      configDir,
      env: localConfigDir ? { OPENCODE_CONFIG_DIR: localConfigDir } : {},
    };
  }

  const rootDir = join(options.dataDir, ONMYAGENT_DEV_DATA_DIR);
  const homeDir = join(rootDir, "home");
  const xdgConfigHome = join(rootDir, "xdg", "config");
  const xdgDataHome = join(rootDir, "xdg", "data");
  const xdgCacheHome = join(rootDir, "xdg", "cache");
  const xdgStateHome = join(rootDir, "xdg", "state");
  const configDir = localConfigDir ?? join(rootDir, "config", "opencode");

  return {
    devMode: true,
    rootDir,
    configDir,
    importConfigDir:
      process.env.ONMYAGENT_DEV_OPENCODE_IMPORT_CONFIG_DIR?.trim() || undefined,
    importDataDir:
      process.env.ONMYAGENT_DEV_OPENCODE_IMPORT_DATA_DIR?.trim() || undefined,
    env: {
      ONMYAGENT_DEV_MODE: "1",
      OPENCODE_TEST_HOME: homeDir,
      HOME: homeDir,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: xdgDataHome,
      XDG_CACHE_HOME: xdgCacheHome,
      XDG_STATE_HOME: xdgStateHome,
      OPENCODE_CONFIG_DIR: configDir,
    },
  };
}

export async function ensureOpencodeStateLayout(
  layout: OpencodeStateLayout,
): Promise<void> {
  await mkdir(layout.configDir, { recursive: true });
  if (!layout.devMode) return;

  const homeDir = layout.env.HOME;
  const xdgConfigHome = layout.env.XDG_CONFIG_HOME;
  const xdgDataHome = layout.env.XDG_DATA_HOME;
  const xdgCacheHome = layout.env.XDG_CACHE_HOME;
  const xdgStateHome = layout.env.XDG_STATE_HOME;
  const opencodeDataDir = xdgDataHome
    ? join(xdgDataHome, "opencode")
    : undefined;

  for (const dir of [
    layout.rootDir,
    homeDir,
    xdgConfigHome,
    xdgDataHome,
    xdgCacheHome,
    xdgStateHome,
    opencodeDataDir,
  ]) {
    if (!dir) continue;
    await mkdir(dir, { recursive: true });
  }

  if (layout.importConfigDir && (await isDir(layout.importConfigDir))) {
    const entries = await readdir(layout.configDir).catch(() => [] as string[]);
    if (entries.length === 0) {
      await cp(layout.importConfigDir, layout.configDir, {
        recursive: true,
        force: false,
      }).catch(() => undefined);
    }
  }

  if (
    layout.importDataDir &&
    opencodeDataDir &&
    (await isDir(layout.importDataDir))
  ) {
    for (const file of ["auth.json", "mcp-auth.json"]) {
      const dest = join(opencodeDataDir, file);
      if (await fileExists(dest)) continue;
      const source = join(layout.importDataDir, file);
      if (await fileExists(source)) {
        await copyFile(source, dest).catch(() => undefined);
      }
    }
  }
}
