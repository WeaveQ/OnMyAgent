import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import { delimiter, join } from "node:path";

/**
 * @param {string} [platform]
 * @returns {"macos" | "windows" | "linux" | "unknown"}
 */
export function normalizeDesktopPlatform(platform = process.platform) {
  const value = String(platform ?? "");
  if (value === "darwin" || value === "macos") return "macos";
  if (value === "win32" || value === "windows") return "windows";
  if (value === "linux") return "linux";
  return "unknown";
}

/**
 * @param {string} [platform]
 */
export function isComputerUsePlatformSupported(platform = process.platform) {
  const normalized = normalizeDesktopPlatform(platform);
  return normalized === "macos" || normalized === "windows";
}

/**
 * @param {string} [platform]
 */
export function isAppshotPlatformSupported(platform = process.platform) {
  const normalized = normalizeDesktopPlatform(platform);
  return normalized === "macos" || normalized === "windows" || normalized === "linux";
}

/**
 * @param {string} [platform]
 */
export function isSandboxExecPlatformSupported(platform = process.platform) {
  return normalizeDesktopPlatform(platform) === "macos";
}

/**
 * @param {string} [platform]
 */
export function computerUseUnsupportedReason(platform = process.platform) {
  const normalized = normalizeDesktopPlatform(platform);
  if (normalized === "macos" || normalized === "windows") return null;
  if (normalized === "linux") {
    return "Computer Use is not supported on Linux. HandsFree is macOS-only; Cua Driver is Windows-only.";
  }
  return "Computer Use is not supported on this platform.";
}

/**
 * @param {string} [platform]
 */
export function sandboxExecUnsupportedReason(platform = process.platform) {
  if (isSandboxExecPlatformSupported(platform)) return null;
  return "sandbox-exec isolation is macOS-only and is not available on this platform.";
}

/**
 * Linux process isolation backend: docker (existing runtime path), bwrap, or none.
 * Does not port macOS sandbox-exec. Detection is PATH/exists only — no probes.
 *
 * @param {{
 *   platform?: string,
 *   env?: NodeJS.ProcessEnv,
 *   existsSync?: (path: string) => boolean,
 * }} [options]
 * @returns {"docker" | "bwrap" | "none"}
 */
export function resolveLinuxSandboxBackend({
  platform = process.platform,
  env = process.env,
  existsSync: exists = existsSync,
} = {}) {
  if (normalizeDesktopPlatform(platform) !== "linux") return "none";
  const seen = new Set();
  const dockerBins = [];
  const push = (value) => {
    const trimmed = String(value ?? "").trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    dockerBins.push(trimmed);
  };
  for (const key of ["ONMYAGENT_DOCKER_BIN", "OPENWRK_DOCKER_BIN", "DOCKER_BIN"]) {
    if (env[key]) push(env[key]);
  }
  const pathDirs = String(env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const dir of pathDirs) push(join(dir, "docker"));
  push("/usr/bin/docker");
  push("/usr/local/bin/docker");
  for (const bin of dockerBins) {
    if (exists(bin)) return "docker";
  }

  const bwrapSeen = new Set();
  const bwrapBins = [];
  const pushBwrap = (value) => {
    const trimmed = String(value ?? "").trim();
    if (!trimmed || bwrapSeen.has(trimmed)) return;
    bwrapSeen.add(trimmed);
    bwrapBins.push(trimmed);
  };
  for (const dir of pathDirs) pushBwrap(join(dir, "bwrap"));
  pushBwrap("/usr/bin/bwrap");
  pushBwrap("/usr/local/bin/bwrap");
  for (const bin of bwrapBins) {
    if (exists(bin)) return "bwrap";
  }
  return "none";
}

export function linuxSandboxUnsupportedReason(backend) {
  if (backend === "docker" || backend === "bwrap") return null;
  return "Linux process isolation uses Docker or bubblewrap when available; neither was found, so sandbox is skipped.";
}

/**
 * @param {string} [status]
 * @returns {"granted" | "denied" | "unknown"}
 */
function normalizePermissionStatus(status) {
  if (status === "granted" || status === "denied") return status;
  return "unknown";
}

/**
 * Real Linux permission rows. Workspace/fs is actually checked.
 * Camera/mic/accessibility stay unknown — never fake granted.
 *
 * @param {{
 *   homeDir?: string,
 *   readdirSync?: (path: string) => unknown,
 *   notificationStatus?: string,
 *   microphoneStatus?: string,
 *   screenRecordingStatus?: string,
 * }} [options]
 */
export function buildLinuxSystemPermissions({
  homeDir,
  readdirSync: readDir = readdirSync,
  notificationStatus = "unknown",
  microphoneStatus = "unknown",
  screenRecordingStatus = "unknown",
} = {}) {
  let workspace = "unknown";
  const root = String(homeDir ?? "").trim() || os.homedir();
  try {
    readDir(root);
    workspace = "granted";
  } catch (err) {
    if (err?.code === "EACCES" || err?.code === "EPERM") workspace = "denied";
    else workspace = "unknown";
  }
  return {
    "full-disk-access": workspace,
    accessibility: "unknown",
    automation: "unknown",
    notifications: normalizePermissionStatus(notificationStatus),
    "screen-recording": normalizePermissionStatus(screenRecordingStatus),
    microphone: normalizePermissionStatus(microphoneStatus),
  };
}

/**
 * Linux Settings targets. Never throws; caller may xdg-open / spawn.
 * @param {string | undefined} type
 * @param {{ desktop?: string }} [options]
 */
export function resolveLinuxPermissionSettingsCommand(type, { desktop = "" } = {}) {
  const env = String(desktop ?? "").toLowerCase();
  const isGnome = env.includes("gnome") || env.includes("unity") || env.includes("cinnamon");
  const isKde = env.includes("kde") || env.includes("plasma");
  if (isGnome) {
    if (type === "notifications") return { command: "gnome-control-center", args: ["notifications"] };
    if (type === "microphone" || type === "screen-recording") {
      return { command: "gnome-control-center", args: ["privacy"] };
    }
  }
  if (isKde) {
    if (type === "notifications") return { command: "systemsettings", args: ["kcm_notifications"] };
    if (type === "microphone" || type === "screen-recording") {
      return { command: "systemsettings", args: ["kcm_privacy"] };
    }
  }
  if (type === "notifications") return { command: "xdg-open", args: ["settings://notifications"] };
  if (type === "microphone") return { command: "xdg-open", args: ["settings://privacy"] };
  if (type === "screen-recording") return { command: "xdg-open", args: ["settings://privacy"] };
  return { command: "xdg-open", args: ["settings://"] };
}

/**
 * @param {string} [platform]
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   existsSync?: (path: string) => boolean,
 * }} [options]
 */
export function resolveDesktopPlatformCapabilities(
  platform = process.platform,
  options = {},
) {
  const normalized = normalizeDesktopPlatform(platform);
  const computerUseSupported = isComputerUsePlatformSupported(platform);
  const appshotSupported = isAppshotPlatformSupported(platform);
  const sandboxExecSupported = isSandboxExecPlatformSupported(platform);
  const linuxSandboxBackend = resolveLinuxSandboxBackend({
    platform,
    env: options.env,
    existsSync: options.existsSync,
  });
  const sandboxBackend = sandboxExecSupported
    ? "sandbox-exec"
    : normalized === "linux"
      ? linuxSandboxBackend
      : "none";
  return {
    platform: normalized,
    computerUse: {
      supported: computerUseSupported,
      reason: computerUseUnsupportedReason(platform),
      backend: normalized === "macos" ? "handsfree" : normalized === "windows" ? "cua" : "none",
    },
    appshot: {
      supported: appshotSupported,
      reason: appshotSupported ? null : "Appshot is not available on this platform.",
    },
    sandboxExec: {
      supported: sandboxExecSupported,
      reason: sandboxExecUnsupportedReason(platform),
    },
    sandbox: {
      supported: sandboxBackend !== "none",
      backend: sandboxBackend,
      reason:
        sandboxBackend === "sandbox-exec"
          ? null
          : normalized === "linux"
            ? linuxSandboxUnsupportedReason(linuxSandboxBackend)
            : sandboxExecUnsupportedReason(platform),
    },
  };
}
