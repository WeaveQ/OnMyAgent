/** Client platform for Appshot naming / availability (Electron + browser). */
export function detectClientPlatform(): "macos" | "windows" | "linux" | "unknown" {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent ?? "";
  const platform = navigator.platform ?? "";
  if (/Mac|Macintosh|Darwin/i.test(platform) || /Mac OS X|Macintosh/i.test(ua)) {
    return "macos";
  }
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return "windows";
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return "linux";
  return "unknown";
}

/** Reject Swift debug dumps / control junk so notice + chips stay readable. */
export function isSafeAttachmentDisplayName(name: string): boolean {
  const value = name.trim();
  if (!value || value.length > 96) return false;
  if (/JoinedSequence|ArraySlice|ContiguousArray|_base|_separator|Array</i.test(value)) {
    return false;
  }
  // No control chars / newlines; allow normal unicode file names.
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  return !value.includes("\n") && !value.includes("\r");
}

/**
 * Cross-platform Appshot basename.
 * - macOS: strips Swift JoinedSequence dumps from the native helper
 * - Windows: strips reserved device names and illegal path characters
 * - Linux / fallback: same safe basename rules
 */
export function sanitizeAppshotFileName(
  raw: string,
  platform: "macos" | "windows" | "linux" | "unknown" = detectClientPlatform(),
): string {
  const value = raw.trim().replace(/\\/g, "/");
  const base = value.includes("/") ? value.slice(value.lastIndexOf("/") + 1) : value;
  let candidate = base
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-")
    .replace(/\.+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const reservedWin =
    platform === "windows" &&
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(candidate);

  const looksBad =
    !candidate ||
    !isSafeAttachmentDisplayName(candidate) ||
    reservedWin ||
    !/^Appshot[-_\w. ()]+\.(jpe?g|png|webp)$/i.test(candidate);

  if (!looksBad) {
    return candidate.replace(/\.jpeg$/i, ".jpg");
  }

  const stamp = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stampText = [
    stamp.getFullYear(),
    pad(stamp.getMonth() + 1),
    pad(stamp.getDate()),
    "-",
    pad(stamp.getHours()),
    pad(stamp.getMinutes()),
    pad(stamp.getSeconds()),
  ].join("");
  return `Appshot-${stampText}.jpg`;
}

/** Native Appshot helper is macOS-only today (Swift HandsFree). */
export function isAppshotCaptureSupported(): boolean {
  if (typeof window === "undefined") return false;
  if (!window.__ONMYAGENT_ELECTRON__?.computerUse) return false;
  return detectClientPlatform() === "macos";
}
