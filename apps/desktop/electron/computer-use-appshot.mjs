/**
 * Composer Appshot (desktop capture) — Electron-only.
 *
 * Capture uses desktopCapturer (OnMyAgent / Electron Screen Recording identity).
 * Hotkeys use Electron globalShortcut via settings keymap (appSnapshot), not a native helper.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const MAX_THUMB_EDGE = 2560;

export function isComputerUseAppshotSupported(platform = process.platform) {
  return platform === "darwin" || platform === "win32" || platform === "linux";
}

/**
 * Normalize Appshot filenames across platforms.
 */
export function sanitizeAppshotFileName(
  rawName,
  { platform = process.platform, now = Date.now() } = {},
) {
  const raw = typeof rawName === "string" ? rawName.trim() : "";
  const looksLikeSwiftDump =
    /JoinedSequence|ArraySlice|ContiguousArray|_base|_separator|Array</i.test(
      raw,
    );
  const base = path.basename(raw.replace(/\\/g, "/"));
  let candidate = base || raw;

  candidate = candidate.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-");
  candidate = candidate.replace(/\.+$/g, "");
  candidate = candidate.replace(/\s+/g, " ").trim();

  const reserved =
    platform === "win32" &&
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(candidate);

  const extMatch = candidate.match(/\.(jpe?g|png|webp)$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : ".jpg";
  const stem = extMatch
    ? candidate.slice(0, -extMatch[0].length)
    : candidate;

  const safeStem =
    stem &&
    stem.length <= 80 &&
    !looksLikeSwiftDump &&
    !reserved &&
    !/JoinedSequence|ArraySlice/i.test(stem)
      ? stem
      : null;

  if (safeStem && /^Appshot[-_\w. ()]+$/i.test(safeStem)) {
    return `${safeStem}${ext === ".jpeg" ? ".jpg" : ext}`;
  }

  const stamp = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
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

function mediaStatusToPermission(status) {
  if (status === "granted") return "granted";
  if (status === "denied" || status === "restricted") return "denied";
  return "unknown";
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {Error & { code: string }}
 */
function appshotError(code, message) {
  /** @type {Error & { code: string }} */
  const err = Object.assign(new Error(message), { code });
  return err;
}

export function isMostlyBlackNativeImage(nativeImage) {
  if (!nativeImage || typeof nativeImage.isEmpty !== "function") return false;
  if (nativeImage.isEmpty()) return true;
  try {
    const small =
      typeof nativeImage.resize === "function"
        ? nativeImage.resize({ width: 32, height: 32 })
        : nativeImage;
    const buf = typeof small.toBitmap === "function" ? small.toBitmap() : null;
    if (!buf || buf.length < 4) return false;
    let dark = 0;
    let n = 0;
    let max = 0;
    for (let i = 0; i + 2 < buf.length; i += 4) {
      const v = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
      if (v > max) max = v;
      if (v < 12) dark += 1;
      n += 1;
    }
    return n > 0 && dark / n >= 0.97 && max < 40;
  } catch {
    return false;
  }
}

function makeAppshotStampName(appName = "Desktop") {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
  const slug =
    String(appName || "Desktop")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "Desktop";
  return `Appshot-${stamp}-${slug}.jpg`;
}

export function appshotRootDir(env = process.env) {
  const override = env.ONMYAGENT_COMPUTER_USE_APPSHOT_ROOT?.trim();
  if (override) return override;
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "OnMyAgent",
      "ComputerUse",
      "Appshots",
    );
  }
  if (process.platform === "win32") {
    const base =
      env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "OnMyAgent", "ComputerUse", "Appshots");
  }
  const base =
    env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(base, "OnMyAgent", "ComputerUse", "Appshots");
}

/**
 * @param {object} deps
 */
export function createAppshotController(deps) {
  const app = deps.app;
  const systemPreferences = deps.systemPreferences ?? null;
  const desktopCapturer = deps.desktopCapturer ?? null;
  const electronScreen = deps.screen ?? null;
  const readFile = deps.readFile ?? readFileSync;
  const writeFile = deps.writeFile ?? writeFileSync;

  function permissionHint() {
    const isDev = !app?.isPackaged;
    const listName = isDev ? "Electron" : app?.getName?.() || "OnMyAgent";
    if (process.platform === "darwin") {
      return `Open System Settings → Privacy & Security → Screen Recording, enable “${listName}”, then fully quit and reopen the app.`;
    }
    if (process.platform === "win32") {
      return "If capture is blank, check Windows privacy settings for screen capture.";
    }
    return "Screen capture may require portal permission on Linux (Wayland).";
  }

  function screenRecordingStatus() {
    if (process.platform !== "darwin") return "unknown";
    try {
      if (typeof systemPreferences?.getMediaAccessStatus === "function") {
        return mediaStatusToPermission(
          systemPreferences.getMediaAccessStatus("screen"),
        );
      }
    } catch {
      // ignore
    }
    return "unknown";
  }

  function resolveThumbnailSize() {
    let width = 1920;
    let height = 1080;
    try {
      const display =
        electronScreen?.getPrimaryDisplay?.() ??
        electronScreen?.getAllDisplays?.()?.[0];
      if (display?.size) {
        const scale = Number(display.scaleFactor) || 1;
        width = Math.round(display.size.width * scale);
        height = Math.round(display.size.height * scale);
      }
    } catch {
      // defaults
    }
    const scale = Math.min(1, MAX_THUMB_EDGE / Math.max(width, height, 1));
    return {
      width: Math.max(320, Math.round(width * scale)),
      height: Math.max(240, Math.round(height * scale)),
    };
  }

  function attachmentPayload(result) {
    if (
      typeof result !== "object" ||
      result === null ||
      result.ok !== true ||
      typeof result.path !== "string" ||
      typeof result.name !== "string" ||
      typeof result.mimeType !== "string"
    ) {
      throw new Error("Invalid Appshot result.");
    }
    return {
      name: sanitizeAppshotFileName(result.name),
      mimeType: result.mimeType,
      data: readFile(result.path).toString("base64"),
      ...(typeof result.appName === "string" ? { appName: result.appName } : {}),
    };
  }

  async function primeScreenRecordingPermission() {
    if (!desktopCapturer?.getSources) return;
    try {
      await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 1, height: 1 },
        fetchWindowIcons: false,
      });
    } catch {
      // TCC registration only
    }
  }

  function pickScreenSource(sources) {
    let primaryId = null;
    try {
      primaryId = electronScreen?.getPrimaryDisplay?.()?.id ?? null;
    } catch {
      primaryId = null;
    }
    return (
      (primaryId != null
        ? sources.find(
            (s) =>
              s.display_id === String(primaryId) ||
              s.display_id === primaryId ||
              s.id === `screen:${primaryId}:0`,
          )
        : null) ??
      sources.find((s) =>
        /entire screen|screen 1|display 1/i.test(String(s.name ?? "")),
      ) ??
      sources[0]
    );
  }

  async function captureComputerUseAppshot() {
    if (!isComputerUseAppshotSupported()) {
      throw new Error("Appshot is not available on this platform.");
    }
    if (!desktopCapturer?.getSources) {
      throw new Error("Screen capture is not available in this build.");
    }

    if (process.platform === "darwin") {
      const status = screenRecordingStatus();
      if (status === "denied") {
        await primeScreenRecordingPermission();
        throw appshotError(
          "APPSHOT_PERMISSION_DENIED",
          `Screen Recording is denied. ${permissionHint()}`,
        );
      }
      // "unknown" covers not-determined and other non-granted states.
      if (status === "unknown") {
        await primeScreenRecordingPermission();
      }
    }

    const { width, height } = resolveThumbnailSize();
    let sources;
    try {
      sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width, height },
        fetchWindowIcons: false,
      });
    } catch (error) {
      throw appshotError(
        "APPSHOT_CAPTURE_FAILED",
        error instanceof Error
          ? error.message
          : "Screen capture failed. Check Screen Recording permission.",
      );
    }

    if (!Array.isArray(sources) || sources.length === 0) {
      throw appshotError(
        "APPSHOT_NO_SOURCES",
        `No screen sources available. ${permissionHint()}`,
      );
    }

    const thumb = pickScreenSource(sources)?.thumbnail;
    if (!thumb || (typeof thumb.isEmpty === "function" && thumb.isEmpty())) {
      throw appshotError(
        "APPSHOT_EMPTY",
        `Screen capture returned an empty image. ${permissionHint()}`,
      );
    }
    if (isMostlyBlackNativeImage(thumb)) {
      throw appshotError(
        "APPSHOT_BLACK",
        `Screen capture returned a black image (usually missing Screen Recording permission). ${permissionHint()}`,
      );
    }

    const useJpeg = typeof thumb.toJPEG === "function";
    const bytes = useJpeg ? thumb.toJPEG(85) : thumb.toPNG();
    if (!bytes || bytes.length < 500) {
      throw appshotError(
        "APPSHOT_EMPTY",
        `Screen capture produced no image data. ${permissionHint()}`,
      );
    }

    const root = appshotRootDir();
    mkdirSync(root, { recursive: true });
    const name = makeAppshotStampName("Desktop");
    const filePath = path.join(root, name);
    writeFile(filePath, bytes);

    return attachmentPayload({
      ok: true,
      path: filePath,
      name,
      mimeType: useJpeg ? "image/jpeg" : "image/png",
      appName: "Desktop",
    });
  }

  // No-op stubs: hotkeys are Electron globalShortcut (settings → shortcuts).
  function startAppshotMonitor() {}
  function stopAppshotMonitor() {}
  function watchComputerUseAppshots(_onAppshot) {
    return () => {};
  }
  function disposeAppshot() {
    stopAppshotMonitor();
  }

  return {
    captureComputerUseAppshot,
    startAppshotMonitor,
    stopAppshotMonitor,
    watchComputerUseAppshots,
    disposeAppshot,
    primeScreenRecordingPermission,
    isComputerUseAppshotSupported,
    sanitizeAppshotFileName,
  };
}
