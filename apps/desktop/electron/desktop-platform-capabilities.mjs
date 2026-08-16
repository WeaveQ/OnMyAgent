export function normalizeDesktopPlatform(platform = process.platform) {
  const value = String(platform ?? "");
  if (value === "darwin" || value === "macos") return "macos";
  if (value === "win32" || value === "windows") return "windows";
  if (value === "linux") return "linux";
  return "unknown";
}

export function isComputerUsePlatformSupported(platform = process.platform) {
  const normalized = normalizeDesktopPlatform(platform);
  return normalized === "macos" || normalized === "windows";
}

export function isAppshotPlatformSupported(platform = process.platform) {
  const normalized = normalizeDesktopPlatform(platform);
  return normalized === "macos" || normalized === "windows" || normalized === "linux";
}

export function isSandboxExecPlatformSupported(platform = process.platform) {
  return normalizeDesktopPlatform(platform) === "macos";
}

export function computerUseUnsupportedReason(platform = process.platform) {
  const normalized = normalizeDesktopPlatform(platform);
  if (normalized === "macos" || normalized === "windows") return null;
  if (normalized === "linux") {
    return "Computer Use is not supported on Linux. HandsFree is macOS-only; Cua Driver is Windows-only.";
  }
  return "Computer Use is not supported on this platform.";
}

export function sandboxExecUnsupportedReason(platform = process.platform) {
  if (isSandboxExecPlatformSupported(platform)) return null;
  return "sandbox-exec isolation is macOS-only and is not available on this platform.";
}

export function resolveDesktopPlatformCapabilities(platform = process.platform) {
  const normalized = normalizeDesktopPlatform(platform);
  const computerUseSupported = isComputerUsePlatformSupported(platform);
  const appshotSupported = isAppshotPlatformSupported(platform);
  const sandboxExecSupported = isSandboxExecPlatformSupported(platform);
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
  };
}
