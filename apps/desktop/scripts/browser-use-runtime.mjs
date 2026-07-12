import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const constantsPath = path.resolve(scriptsDir, "../../..", "constants.json");
const constants = JSON.parse(readFileSync(constantsPath, "utf8"));

export const BROWSER_USE_VERSION = String(constants.browserUseVersion ?? "").trim();
export const BROWSER_HARNESS_VERSION = String(
  constants.browserHarnessVersion ?? "",
).trim();

if (!BROWSER_USE_VERSION || !BROWSER_HARNESS_VERSION) {
  throw new Error("constants.json is missing bundled Browser Use versions");
}

export function browserUseManifestFields() {
  return {
    browserUse: BROWSER_USE_VERSION,
    browserHarness: BROWSER_HARNESS_VERSION,
  };
}

export function browserUseInstallArgs() {
  return [
    "-m",
    "pip",
    "install",
    "--disable-pip-version-check",
    "--no-cache-dir",
    `browser-use[cli]==${BROWSER_USE_VERSION}`,
  ];
}

export function browserUseLauncherContents(platform = process.platform) {
  if (platform === "win32") {
    return [
      "@echo off",
      "set ANONYMIZED_TELEMETRY=false",
      '"%~dp0..\\python\\python.exe" -c "from browser_use.cli import main; main()" %*',
      "",
    ].join("\r\n");
  }
  return [
    "#!/bin/sh",
    'SCRIPT_DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)',
    "export ANONYMIZED_TELEMETRY=false",
    'exec "$SCRIPT_DIR/../python/bin/python3" -c \'from browser_use.cli import main; main()\' "$@"',
    "",
  ].join("\n");
}

function runtimePaths(targetRoot, platform = process.platform) {
  const windows = platform === "win32";
  return {
    pythonPath: path.join(
      targetRoot,
      "python",
      windows ? "python.exe" : "bin/python3",
    ),
    launcherPath: path.join(
      targetRoot,
      "bin",
      windows ? "browser-use.cmd" : "browser-use",
    ),
  };
}

export function resolveBundledBrowserUseRuntime(
  targetRoot,
  platform = process.platform,
) {
  const { pythonPath, launcherPath } = runtimePaths(targetRoot, platform);
  return {
    ready: existsSync(pythonPath) && existsSync(launcherPath),
    pythonPath,
    launcherPath,
    browserUseVersion: BROWSER_USE_VERSION,
    browserHarnessVersion: BROWSER_HARNESS_VERSION,
  };
}

export function prepareBrowserUseRuntime(
  targetRoot,
  { platform = process.platform, spawn = spawnSync } = {},
) {
  const { pythonPath, launcherPath } = runtimePaths(targetRoot, platform);
  if (!existsSync(pythonPath)) {
    throw new Error(`Bundled Python is missing: ${pythonPath}`);
  }

  const install = spawn(pythonPath, browserUseInstallArgs(), {
    cwd: targetRoot,
    env: {
      ...process.env,
      ANONYMIZED_TELEMETRY: "false",
      PIP_NO_INPUT: "1",
    },
    stdio: "inherit",
  });
  if (install.status !== 0) {
    throw new Error(`Browser Use installation failed with status ${install.status}`);
  }

  const versionProbe = spawn(
    pythonPath,
    [
      "-c",
      [
        "from importlib.metadata import version",
        `assert version('browser-use') == '${BROWSER_USE_VERSION}'`,
        `assert version('browser-harness') == '${BROWSER_HARNESS_VERSION}'`,
      ].join("; "),
    ],
    { cwd: targetRoot, encoding: "utf8" },
  );
  if (versionProbe.status !== 0) {
    const detail = String(versionProbe.stderr ?? versionProbe.stdout ?? "").trim();
    throw new Error(`Browser Use version validation failed: ${detail}`);
  }

  mkdirSync(path.dirname(launcherPath), { recursive: true });
  writeFileSync(launcherPath, browserUseLauncherContents(platform), "utf8");
  if (platform !== "win32") chmodSync(launcherPath, 0o755);
  return resolveBundledBrowserUseRuntime(targetRoot, platform);
}
