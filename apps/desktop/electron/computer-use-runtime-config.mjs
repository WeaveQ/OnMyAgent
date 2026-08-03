import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const COMPUTER_USE_HELPER_APP_NAME = "OnMyAgent Computer Use.app";
const COMPUTER_USE_HELPER_EXECUTABLE = "ComputerUse";
/** Staged Cua Driver directory under resources/helpers (Windows). */
export const CUA_HELPER_DIR_NAME = "cua";
export const CUA_DRIVER_EXECUTABLE = "cua-driver.exe";
const COMPUTER_USE_CONFIG_FILE = "onmyagent-computer-use.json";

/**
 * Whether the computer-use MCP entry should be enabled in OpenCode config.
 * - Explicit options.enabled wins.
 * - ONMYAGENT_COMPUTER_USE_ENABLED=0|false|1|true overrides defaults.
 * - Default: darwin on, win32 off (user must opt in via settings later).
 */
export function isComputerUseMcpEnabled(options = {}) {
  if (options.enabled === true) return true;
  if (options.enabled === false) return false;

  const env = String(
    options.env?.ONMYAGENT_COMPUTER_USE_ENABLED ??
      process.env.ONMYAGENT_COMPUTER_USE_ENABLED ??
      "",
  )
    .trim()
    .toLowerCase();
  if (env === "0" || env === "false" || env === "off" || env === "no") {
    return false;
  }
  if (env === "1" || env === "true" || env === "on" || env === "yes") {
    return true;
  }

  const platform = options.platform ?? process.platform;
  return platform === "darwin";
}

function resolveDarwinComputerUseCommand(options) {
  const candidates = [
    options.explicitBinary?.trim(),
    options.resourcesPath
      ? path.join(
          options.resourcesPath,
          "helpers",
          COMPUTER_USE_HELPER_APP_NAME,
          "Contents",
          "MacOS",
          COMPUTER_USE_HELPER_EXECUTABLE,
        )
      : null,
    path.join(
      options.desktopRoot,
      "resources",
      "helpers",
      COMPUTER_USE_HELPER_APP_NAME,
      "Contents",
      "MacOS",
      COMPUTER_USE_HELPER_EXECUTABLE,
    ),
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (executable) return [executable, "mcp"];

  if (!options.devMode) return null;
  return [
    "node",
    path.resolve(
      options.desktopRoot,
      "../..",
      "packages/handsfree/bin/onmyagent-handsfree-computer-use.mjs",
    ),
    "mcp",
  ];
}

/**
 * Resolve staged Cua driver on Windows.
 * Returns { command, cwd } so the MCP process can find sibling binaries
 * (e.g. cua-driver-uia.exe) in the same directory.
 */
export function resolveWindowsCuaDriver(options = {}) {
  const explicit =
    options.explicitBinary?.trim() ||
    options.env?.ONMYAGENT_CUA_DRIVER?.trim() ||
    process.env.ONMYAGENT_CUA_DRIVER?.trim() ||
    options.env?.ONMYAGENT_COMPUTER_USE_BINARY?.trim() ||
    process.env.ONMYAGENT_COMPUTER_USE_BINARY?.trim() ||
    "";

  const candidates = [
    explicit || null,
    options.resourcesPath
      ? path.join(
          options.resourcesPath,
          "helpers",
          CUA_HELPER_DIR_NAME,
          CUA_DRIVER_EXECUTABLE,
        )
      : null,
    options.desktopRoot
      ? path.join(
          options.desktopRoot,
          "resources",
          "helpers",
          CUA_HELPER_DIR_NAME,
          CUA_DRIVER_EXECUTABLE,
        )
      : null,
  ].filter(Boolean);

  for (const executable of candidates) {
    if (!existsSync(executable)) continue;
    return {
      command: [executable, "mcp"],
      cwd: path.dirname(executable),
    };
  }
  return null;
}

function resolveWin32ComputerUseCommand(options) {
  const resolved = resolveWindowsCuaDriver(options);
  if (!resolved) return null;
  // OpenCode local MCP: command array only (no reliable cwd field).
  // Prefer absolute path to the exe; siblings must sit next to it (full stage).
  // Wrap via cmd so the process starts with the helper directory as cwd.
  const [exe, ...args] = resolved.command;
  return [
    "cmd.exe",
    "/d",
    "/s",
    "/c",
    `cd /d "${resolved.cwd.replace(/"/g, '""')}" && "${exe.replace(/"/g, '""')}" ${args.map((a) => `"${String(a).replace(/"/g, '""')}"`).join(" ")}`,
  ];
}

/**
 * Resolve the OpenCode MCP command for computer-use on the current platform.
 * Returns string[] or null when the platform has no helper.
 */
export function resolveComputerUseRuntimeCommand(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    return resolveDarwinComputerUseCommand(options);
  }
  if (platform === "win32") {
    return resolveWin32ComputerUseCommand(options);
  }
  return null;
}

/**
 * @param {string} configDir
 * @param {string[]} command
 * @param {{ enabled?: boolean }} [options]
 */
export async function writeComputerUseRuntimeConfig(
  configDir,
  command,
  options = {},
) {
  await mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, COMPUTER_USE_CONFIG_FILE);
  const enabled =
    typeof options.enabled === "boolean" ? options.enabled : true;
  const config = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      "computer-use": {
        type: "local",
        command,
        enabled,
      },
    },
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}
