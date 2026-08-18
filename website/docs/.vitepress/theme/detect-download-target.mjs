/**
 * Pick which website-download asset to recommend.
 * @param {{
 *   userAgent?: string,
 *   platform?: string,
 *   uaDataPlatform?: string,
 *   architecture?: string,
 *   webglRenderer?: string,
 * }} hints
 * @returns {"mac-arm64" | "mac-x64" | "win-x64" | null}
 */
export function detectRecommendedPackage(hints = {}) {
  const userAgent = String(hints.userAgent ?? "");
  const platform = String(hints.platform ?? "");
  const uaDataPlatform = String(hints.uaDataPlatform ?? "");
  const architecture = String(hints.architecture ?? "").toLowerCase();
  const webglRenderer = String(hints.webglRenderer ?? "");

  if (
    /Windows|Win32|Win64|WOW64/i.test(userAgent) ||
    /^Win/i.test(platform) ||
    /Windows/i.test(uaDataPlatform)
  ) {
    return "win-x64";
  }

  const isMac =
    /Mac/i.test(userAgent) ||
    /Mac/i.test(platform) ||
    /macOS|Mac OS/i.test(uaDataPlatform);
  if (!isMac) return null;

  if (architecture.includes("arm")) return "mac-arm64";
  if (
    architecture.includes("x86") ||
    architecture === "x64" ||
    architecture.includes("amd64")
  ) {
    return "mac-x64";
  }
  if (/Apple\s+M\d|Apple GPU/i.test(webglRenderer) && !/Intel|AMD|NVIDIA/i.test(webglRenderer)) {
    return "mac-arm64";
  }
  if (/Intel/i.test(webglRenderer)) return "mac-x64";
  return "mac-arm64";
}
