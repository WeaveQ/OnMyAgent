import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const COMPUTER_USE_HELPER_APP_NAME = "OnMyAgent Computer Use.app";
const COMPUTER_USE_HELPER_EXECUTABLE = "ComputerUse";
const COMPUTER_USE_CONFIG_FILE = "onmyagent-computer-use.json";

export function resolveComputerUseRuntimeCommand(options) {
  if (options.platform !== "darwin") return null;

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

export async function writeComputerUseRuntimeConfig(configDir, command) {
  await mkdir(configDir, { recursive: true });
  const configPath = path.join(configDir, COMPUTER_USE_CONFIG_FILE);
  const config = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      "computer-use": {
        type: "local",
        command,
        enabled: true,
      },
    },
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}
