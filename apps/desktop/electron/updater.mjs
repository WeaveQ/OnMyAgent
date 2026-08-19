import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { showDesktopNotification } from "./desktop-notification.mjs";
import {
  parseUpdaterManifest,
  pickFallbackArtifactUrl,
  resolveFeedArtifactUrl,
  resolveUpdateFeedUrl,
  resolveUpdaterManifestUrl,
  updaterManifestName,
} from "./update-feed.mjs";

// Background auto-update for packaged desktop builds.
//
// Primary path (packaged macOS / Windows): electron-updater uses the generic
// OSS feed (latest.yml / latest-mac.yml). Download starts when the user
// clicks. Nothing installs until they click "Restart and install"
// (autoInstallOnAppQuit is false by design).
//
// Fallback path (Linux, dev, or when electron-updater fails to initialize):
// fetch the same OSS yaml and open the matching installer URL in a browser.

const RELEASES_HTML_URL = resolveUpdateFeedUrl();
/** Same cadence for packaged + unpackaged (dev) builds. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const INITIAL_CHECK_DELAY_MS = 30 * 1000; // ~30s after app ready
/** Slightly generous: OSS / CDN is often slow or filtered. */
const FETCH_TIMEOUT_MS = 15 * 1000;
const FETCH_RETRY_COUNT = 1;
const FETCH_RETRY_DELAY_MS = 1_200;

/**
 * Unpackaged (dev) background polling is ON by default — same 30s / 6h as
 * packaged. Opt out with ONMYAGENT_UPDATE_CHECK_IN_DEV=0|false|off.
 */
const UPDATE_CHECK_IN_DEV_ENV = String(
  process.env.ONMYAGENT_UPDATE_CHECK_IN_DEV ?? "",
)
  .trim()
  .toLowerCase();
const UPDATE_CHECK_IN_DEV_DISABLED =
  UPDATE_CHECK_IN_DEV_ENV === "0" ||
  UPDATE_CHECK_IN_DEV_ENV === "false" ||
  UPDATE_CHECK_IN_DEV_ENV === "off";
/** Optional full URL override for the fallback yaml fetch. */
const RELEASES_LIST_API_OVERRIDE = String(
  process.env.ONMYAGENT_UPDATE_API ?? "",
).trim();
const LAST_KNOWN_STATE_FILE = "updater-last-known.json";
const AUTO_CHECK_STATE_FILE = "updater-auto-check.json";
/** Subdir of Electron userData; do not use os.homedir() Caches (sandbox HOME). */
const UPDATER_CACHE_DIR_NAME = "updater";
/** Only keep the lightweight fields the renderer needs to prompt a restart. */
const LAST_KNOWN_PERSISTED_KEYS = [
  "available",
  "currentVersion",
  "latestVersion",
  "releaseTag",
  "releaseUrl",
  "releaseName",
  "releaseDate",
  "releaseNotes",
  "readyToInstall",
];

const __updater_dirname = path.dirname(fileURLToPath(import.meta.url));
let _cachedAppVersion = null;

/**
 * @param {string | null | undefined} appLocale
 * @returns {"en" | "zh" | "zh-TW"}
 */
export function resolveUpdaterLocale(appLocale) {
  const raw = String(appLocale ?? "en").trim().toLowerCase().replace(/_/g, "-");
  if (raw.startsWith("zh-tw") || raw.startsWith("zh-hant")) return "zh-TW";
  if (raw.startsWith("zh")) return "zh";
  return "en";
}

const UPDATE_NOTIFICATION_COPY = Object.freeze({
  en: Object.freeze({
    availableTitle: "OnMyAgent update available",
    availableBody: (version) =>
      `Version ${version} is available. Open OnMyAgent to download.`,
    readyTitle: "OnMyAgent update ready",
    readyBody: (version) =>
      `Version ${version} is downloaded. Restart to install.`,
    fallbackTitle: "OnMyAgent update available",
    fallbackBody: (version) =>
      `Version ${version} is available. Click to open the release page.`,
  }),
  zh: Object.freeze({
    availableTitle: "发现新版本",
    availableBody: (version) => `OnMyAgent v${version} 可用。打开应用即可下载。`,
    readyTitle: "更新已就绪",
    readyBody: (version) => `v${version} 已下载。重启即可安装。`,
    fallbackTitle: "发现新版本",
    fallbackBody: (version) => `OnMyAgent v${version} 可用。点击打开发布页。`,
  }),
  "zh-TW": Object.freeze({
    availableTitle: "發現新版本",
    availableBody: (version) => `OnMyAgent v${version} 可用。打開應用即可下載。`,
    readyTitle: "更新已就緒",
    readyBody: (version) => `v${version} 已下載。重新啟動即可安裝。`,
    fallbackTitle: "發現新版本",
    fallbackBody: (version) => `OnMyAgent v${version} 可用。點一下開啟發布頁。`,
  }),
});

/**
 * @param {{
 *   locale?: string | null,
 *   version?: string | null,
 *   kind?: "available" | "ready" | "fallback",
 * }} [input]
 * @returns {{ title: string, body: string }}
 */
export function buildUpdateNotificationCopy(input = {}) {
  const locale = resolveUpdaterLocale(input.locale);
  const version = String(input.version ?? "").trim() || "?";
  const kind =
    input.kind === "ready" || input.kind === "fallback" ? input.kind : "available";
  const copy = UPDATE_NOTIFICATION_COPY[locale] ?? UPDATE_NOTIFICATION_COPY.en;
  if (kind === "ready") {
    return { title: copy.readyTitle, body: copy.readyBody(version) };
  }
  if (kind === "fallback") {
    return { title: copy.fallbackTitle, body: copy.fallbackBody(version) };
  }
  return { title: copy.availableTitle, body: copy.availableBody(version) };
}

function resolveAppLocale(app) {
  try {
    if (typeof app?.getLocale === "function") return app.getLocale();
  } catch {
    // App may not be ready in tests.
  }
  return "en";
}

function resolveAppVersion(app) {
  if (_cachedAppVersion) return _cachedAppVersion;
  const electronVersion = app.getVersion();
  if (app.isPackaged) {
    _cachedAppVersion = electronVersion;
    return electronVersion;
  }
  try {
    const pkgPath = path.resolve(__updater_dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    _cachedAppVersion = pkg.version || electronVersion;
  } catch {
    _cachedAppVersion = electronVersion;
  }
  return _cachedAppVersion;
}

function parseComparableVersion(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^v/i, "");
  if (!normalized) return null;
  const [versionCore] = normalized.split("+", 1);
  if (!versionCore) return null;
  const [releasePart, prereleasePart = ""] = versionCore.split("-", 2);
  const release = releasePart.split(".").map((segment) => Number(segment));
  if (!release.length || release.some((segment) => !Number.isInteger(segment) || segment < 0)) {
    return null;
  }
  const prerelease = prereleasePart
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  return { release, prerelease };
}

function comparePrereleaseIdentifiers(left, right) {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumeric = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumeric = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumeric !== null && rightNumeric !== null) {
      if (leftNumeric !== rightNumeric) return leftNumeric < rightNumeric ? -1 : 1;
      continue;
    }
    if (leftNumeric !== null) return -1;
    if (rightNumeric !== null) return 1;
    const comparison = leftPart.localeCompare(rightPart);
    if (comparison !== 0) return comparison < 0 ? -1 : 1;
  }
  return 0;
}

function compareVersions(left, right) {
  const parsedLeft = parseComparableVersion(left);
  const parsedRight = parseComparableVersion(right);
  if (!parsedLeft || !parsedRight) return null;
  const count = Math.max(parsedLeft.release.length, parsedRight.release.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = parsedLeft.release[index] ?? 0;
    const rightPart = parsedRight.release[index] ?? 0;
    if (leftPart !== rightPart) return leftPart < rightPart ? -1 : 1;
  }
  return comparePrereleaseIdentifiers(parsedLeft.prerelease, parsedRight.prerelease);
}

function isVersionNewer(candidate, current) {
  const comparison = compareVersions(candidate, current);
  return comparison === null ? candidate !== current : comparison > 0;
}

export {
  compareVersions,
  isVersionNewer,
  parseComparableVersion,
};

let quitForUpdateRequested = false;

/** True after the user confirmed Restart and install (quitAndInstall in flight). */
export function isUpdaterQuitForUpdateRequested() {
  return quitForUpdateRequested === true;
}

/** Skip preventDefault-safe-quit when electron-updater is already quitting. */
export function shouldBypassSafeQuitForUpdate(disposeRuntime) {
  if (!quitForUpdateRequested) return false;
  void disposeRuntime();
  return true;
}

/** @internal test helper */
export function resetUpdaterQuitForUpdateRequested() {
  quitForUpdateRequested = false;
}

/** electron-updater download cache — never sandbox HOME Caches. */
export function resolveUpdaterCacheDir(userData) {
  const root = String(userData ?? "").trim() || ".";
  return path.join(root, UPDATER_CACHE_DIR_NAME);
}

export function shouldScheduleAutoChecks(input = {}) {
  if (input.autoCheck !== true) return false;
  if (!input.packaged && input.devDisabled === true) return false;
  return true;
}

/** One check after launch, even if the 6h background toggle is off. */
export function shouldScheduleColdStartCheck(input = {}) {
  if (!input.packaged && input.devDisabled === true) return false;
  return true;
}

export function readPersistedUpdaterAutoCheck(userData) {
  const file = path.join(String(userData ?? "").trim() || ".", AUTO_CHECK_STATE_FILE);
  if (!existsSync(file)) return true;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    // 0.4.29 wrote { autoCheck: false } as the implicit default; no toggle existed.
    // Only honor an explicit off after the user-facing switch writes userSet.
    if (parsed?.userSet !== true) return true;
    return parsed?.autoCheck !== false;
  } catch {
    return true;
  }
}

export function writePersistedUpdaterAutoCheck(userData, autoCheck) {
  const root = String(userData ?? "").trim() || ".";
  mkdirSync(root, { recursive: true });
  const file = path.join(root, AUTO_CHECK_STATE_FILE);
  const tempFile = `${file}.tmp`;
  writeFileSync(
    tempFile,
    JSON.stringify({ autoCheck: autoCheck === true, userSet: true }),
    "utf8",
  );
  renameSync(tempFile, file);
}

function channelState(app, platformFlow) {
  return {
    channel: "stable",
    feedUrl: RELEASES_HTML_URL,
    currentVersion: resolveAppVersion(app),
    /** Lightweight / electron-updater feed has no alpha channel. */
    alphaSupported: false,
    /** "in-app" = download + restart-to-install; "open-browser" = fallback. */
    platformFlow,
  };
}

function resolveUserDataPath(app) {
  try {
    if (app?.getPath) return app.getPath("userData");
  } catch {
    // App may not be ready in tests; fall through to cwd-backed temp path.
  }
  return path.join(process.cwd(), ".onmyagent-updater-test");
}

function resolveLastKnownStatePath(app) {
  return path.join(resolveUserDataPath(app), LAST_KNOWN_STATE_FILE);
}

/**
 * Point electron-updater at userData/updater before the first download.
 * 6.8 joins app.baseCachePath + updaterCacheDirName; both stay under userData.
 * @param {{ app?: { baseCachePath?: string } }} updater
 * @param {string} userData
 */
function applyUpdaterCacheDir(updater, userData) {
  const cacheDir = resolveUpdaterCacheDir(userData);
  try {
    mkdirSync(cacheDir, { recursive: true });
  } catch {
    // First download will mkdir again if this fails.
  }
  const adapter = updater?.app;
  if (!adapter || typeof adapter !== "object") return cacheDir;
  try {
    Object.defineProperty(adapter, "baseCachePath", {
      configurable: true,
      enumerable: true,
      get: () => cacheDir,
    });
  } catch {
    try {
      adapter.baseCachePath = cacheDir;
    } catch {
      // electron-updater falls back to os.homedir() Caches.
    }
  }
  return cacheDir;
}

function pickPersistedLastKnown(payload) {
  if (!payload || typeof payload !== "object") return null;
  const picked = {};
  for (const key of LAST_KNOWN_PERSISTED_KEYS) {
    if (payload[key] !== undefined) picked[key] = payload[key];
  }
  return picked;
}

/**
 * The in-memory availability result resets on relaunch. Persist the last
 * ready-to-install payload so the global "restart to install" toast can still
 * appear on startup even when no renderer was mounted when the download
 * finished. The file is small and lives in userData.
 */
function writeLastKnownSnapshot(app, payload) {
  const picked = pickPersistedLastKnown(payload);
  if (!picked) return;
  try {
    const userData = resolveUserDataPath(app);
    mkdirSync(userData, { recursive: true });
    const target = resolveLastKnownStatePath(app);
    const tempFile = `${target}.tmp`;
    writeFileSync(tempFile, JSON.stringify(picked), "utf8");
    renameSync(tempFile, target);
  } catch (error) {
    console.warn("[updater] failed to persist last known state", error);
  }
}

function readLastKnownSnapshot(app) {
  const target = resolveLastKnownStatePath(app);
  if (!existsSync(target)) return null;
  try {
    const parsed = JSON.parse(readFileSync(target, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.warn("[updater] ignoring invalid persisted updater state", error);
    return null;
  }
}

function clearLastKnownSnapshot(app) {
  try {
    const target = resolveLastKnownStatePath(app);
    if (existsSync(target)) {
      // Atomic write elsewhere means a simple unlink is safe here; avoid
      // leaving `.discarded` files that grow across upgrades.
      unlinkSync(target);
    }
  } catch {
    // Ignore cleanup failures; stale data is validated by version below.
  }
}

/**
 * Classify fetch failures so the renderer can soft-fail with i18n.
 * @returns {{ code: "timeout" | "network" | "http" | "unknown", message: string, soft: boolean }}
 */
function classifyFetchError(error) {
  const name = error && typeof error === "object" ? error.name : null;
  const message = String(error?.message ?? error ?? "");
  if (
    name === "AbortError" ||
    name === "TimeoutError" ||
    /aborted|timeout/i.test(message)
  ) {
    return {
      code: "timeout",
      message:
        "Network timed out while contacting the update server. You can open the release page in a browser instead.",
      soft: true,
    };
  }
  if (
    /fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|network|socket|CERT|SSL|TLS/i.test(
      message,
    )
  ) {
    return {
      code: "network",
      message:
        "Could not reach the update server. Check your network or proxy, or open the release page in a browser.",
      soft: true,
    };
  }
  if (/GitHub API responded|Update server responded/i.test(message)) {
    return { code: "http", message, soft: true };
  }
  return {
    code: "unknown",
    message: message || "Failed to check for updates.",
    soft: true,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function releaseFromManifest(raw, platform, arch) {
  const manifest = parseUpdaterManifest(raw);
  const version = String(manifest.version ?? "").trim();
  if (!version) return { notPublished: true };
  const relative = pickFallbackArtifactUrl(manifest, platform, arch);
  const htmlUrl =
    resolveFeedArtifactUrl(resolveUpdateFeedUrl(), relative) || RELEASES_HTML_URL;
  return {
    tagName: version,
    htmlUrl,
    name: version,
    publishedAt: manifest.releaseDate || null,
    body: null,
    prerelease: false,
    draft: false,
  };
}

async function fetchUpdaterManifest(url, signal) {
  return fetch(url, {
    headers: {
      Accept: "text/yaml, text/plain, */*",
      "User-Agent": "OnMyAgent-UpdateChecker",
    },
    signal,
  });
}

/**
 * @param {{ platform?: NodeJS.Platform, arch?: string }} [options]
 */
async function fetchLatestReleaseOnce(options = {}) {
  const { platform = process.platform, arch = process.arch } = options;
  const manifestUrl =
    RELEASES_LIST_API_OVERRIDE || resolveUpdaterManifestUrl(platform);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("timeout")),
    FETCH_TIMEOUT_MS,
  );
  try {
    let response = await fetchUpdaterManifest(manifestUrl, controller.signal);
    if (
      response.status === 404 &&
      platform === "linux" &&
      !RELEASES_LIST_API_OVERRIDE
    ) {
      response = await fetchUpdaterManifest(
        `${resolveUpdateFeedUrl()}/${updaterManifestName("win32")}`,
        controller.signal,
      );
    }
    if (response.status === 404) {
      return { notPublished: true };
    }
    if (!response.ok) {
      throw new Error(`Update server responded ${response.status}`);
    }
    return releaseFromManifest(await response.text(), platform, arch);
  } finally {
    clearTimeout(timer);
  }
}

/** One retry on soft network/timeout failures. */
async function fetchLatestRelease(options) {
  let lastError = null;
  for (let attempt = 0; attempt <= FETCH_RETRY_COUNT; attempt += 1) {
    try {
      return await fetchLatestReleaseOnce(options);
    } catch (error) {
      lastError = error;
      const classified = classifyFetchError(error);
      if (!classified.soft || attempt >= FETCH_RETRY_COUNT) break;
      await sleep(FETCH_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

/**
 * Decide whether electron-updater should drive updates. Packaged macOS and
 * Windows builds use it; Linux and unpackaged (dev) builds use the fallback.
 */
function supportsInAppUpdater(app, platform) {
  if (!app.isPackaged) return false;
  return platform === "darwin" || platform === "win32";
}

/**
 * @param {{
 *   app: import("electron").App,
 *   ipcMain: import("electron").IpcMain,
 *   getMainWindow: () => import("electron").BrowserWindow | null | undefined,
 *   Notification?: typeof import("electron").Notification,
 *   shell?: import("electron").Shell,
 *   platform?: NodeJS.Platform,
 *   prepareForUpdateInstall?: () => Promise<unknown>,
 *   createAutoUpdater?: () => Promise<any> | any,
 *   pendingInstallTimeoutMs?: number,
 * }} options
 */
export function registerUpdaterIpc({
  app,
  ipcMain,
  getMainWindow,
  Notification,
  shell,
  platform = process.platform,
  prepareForUpdateInstall,
  createAutoUpdater,
  pendingInstallTimeoutMs = 30_000,
}) {
  const inAppSupported = supportsInAppUpdater(app, platform);
  const platformFlow = inAppSupported ? "in-app" : "open-browser";
  /** True only on macOS in-app path, where unnotarized builds hit Gatekeeper. */
  const macQuarantineNotice = inAppSupported && platform === "darwin";

  let lastNotifiedVersion = null;
  /** @type {Record<string, unknown> | null} */
  let lastKnownAvailable = null;
  /** @type {any} */
  let autoUpdater = null;
  let updaterInitError = null;
  /** Tracks the download state emitted by electron-updater. */
  let downloadState = { active: false, percent: 0, ready: false, info: null };
  /** Set when update-downloaded fires so installAndRestart can act. */
  let downloadedUpdateInfo = null;
  /** Settings toggle; default on when no userData file exists. */
  let autoCheckEnabled = readPersistedUpdaterAutoCheck(resolveUserDataPath(app));

  /**
   * Seed in-memory *UI* state from the last successful update-downloaded event.
   * Without this, getLastKnown() returns {available:false} for the first ~30s
   * after relaunch even though the update is staged, and the global restart
   * toast never fires.
   *
   * Intentionally does NOT set `downloadedUpdateInfo`. That flag is reserved
   * for a real electron-updater `update-downloaded` event. With
   * autoDownload=false, checkForUpdates() never emits that event — only
   * downloadUpdate() does (cache-hit, no re-download). installAndRestart
   * and startup therefore call downloadUpdate() so quitAndInstall is wired.
   *
   * The persisted snapshot only claims "ready" when the version is newer than
   * the running app. Once the user installs and runs the new version, the
   * currentVersion check clears the stale snapshot automatically.
   */
  function seedLastKnownFromDisk() {
    if (!inAppSupported) return null;
    const persisted = readLastKnownSnapshot(app);
    if (!persisted?.readyToInstall) return null;
    const currentVersion = resolveAppVersion(app);
    const latestVersion =
      typeof persisted.latestVersion === "string"
        ? persisted.latestVersion.trim()
        : "";
    if (!latestVersion || !isVersionNewer(latestVersion, currentVersion)) {
      clearLastKnownSnapshot(app);
      return null;
    }
    const payload = buildAvailabilityPayload({
      available: true,
      currentVersion,
      latestVersion,
      releaseTag: persisted.releaseTag ?? `v${latestVersion}`,
      releaseUrl: persisted.releaseUrl ?? RELEASES_HTML_URL,
      releaseName: persisted.releaseName ?? null,
      releaseDate: persisted.releaseDate ?? null,
      releaseNotes: persisted.releaseNotes ?? null,
      readyToInstall: true,
    });
    downloadState = {
      active: false,
      percent: 100,
      ready: true,
      // UI-only seed. electron-updater revalidates the pending cache on the next
      // downloadUpdate(); update-downloaded then sets downloadedUpdateInfo.
      info: { version: latestVersion },
    };
    return persistLastKnown(payload);
  }

  /** Resolvers waiting for the next real `update-downloaded` (seed → install). */
  /** @type {Array<(info: unknown) => void>} */
  let downloadReadyWaiters = [];

  function notifyDownloadReady(info) {
    const waiters = downloadReadyWaiters;
    downloadReadyWaiters = [];
    for (const resolve of waiters) {
      try {
        resolve(info);
      } catch {
        // Ignore waiter errors.
      }
    }
  }

  /**
   * Wait until electron-updater reports update-downloaded, or time out.
   * Used when the UI is seed-ready but quitAndInstall is not safe yet.
   * @param {number} timeoutMs
   */
  function waitForDownloadedUpdate(timeoutMs = pendingInstallTimeoutMs) {
    if (downloadedUpdateInfo) {
      return Promise.resolve(downloadedUpdateInfo);
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        downloadReadyWaiters = downloadReadyWaiters.filter((w) => w !== onReady);
        resolve(null);
      }, timeoutMs);
      const onReady = (info) => {
        clearTimeout(timer);
        resolve(info ?? downloadedUpdateInfo);
      };
      downloadReadyWaiters.push(onReady);
    });
  }

  let wiringPendingUpdate = false;
  /**
   * autoDownload is false, so checkForUpdates() only emits update-available.
   * downloadUpdate() cache-hits the staged package and emits update-downloaded,
   * which is what wires quitAndInstall. A prior check is required in-process
   * (electron-updater throws "Please check update first" otherwise).
   * @param {number} [timeoutMs]
   */
  async function ensurePendingUpdateWired(timeoutMs = pendingInstallTimeoutMs) {
    if (downloadedUpdateInfo) return downloadedUpdateInfo;
    if (!autoUpdater) return null;
    if (wiringPendingUpdate) {
      return waitForDownloadedUpdate(timeoutMs);
    }
    wiringPendingUpdate = true;
    try {
      const wait = waitForDownloadedUpdate(timeoutMs);
      try {
        try {
          await autoUpdater.downloadUpdate();
        } catch {
          await autoUpdater.checkForUpdates();
          if (!downloadedUpdateInfo) {
            await autoUpdater.downloadUpdate();
          }
        }
      } catch (error) {
        console.warn("[updater] pending-update wire-up failed", error);
      }
      return (await wait) ?? downloadedUpdateInfo;
    } finally {
      wiringPendingUpdate = false;
    }
  }

  const seededLastKnown = seedLastKnownFromDisk();
  /**
   * When a pending update is restored from disk, the startup revalidation call
   * will still emit "update-available" as electron-updater re-reads the feed.
   * Suppress that one transient event so the renderer shows the higher-priority
   * "ready to install" toast instead of briefly flashing "downloading".
   * @type {string | null}
   */
  let suppressAvailableVersion = seededLastKnown?.latestVersion
    ? String(seededLastKnown.latestVersion).trim()
    : null;

  function sendToRenderer(channel, payload) {
    try {
      const win = typeof getMainWindow === "function" ? getMainWindow() : null;
      if (win?.webContents && !win.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    } catch {
      // Renderer may be gone; ignore.
    }
  }

  function emitAvailable(payload) {
    sendToRenderer("onmyagent:updater:available", payload);
  }

  function emitDownloadProgress(payload) {
    sendToRenderer("onmyagent:updater:download-progress", payload);
  }

  function openReleasePage(url) {
    const target = url || RELEASES_HTML_URL;
    if (shell?.openExternal) {
      shell.openExternal(target).catch(() => undefined);
    }
  }

  /**
   * Common envelope for availability payloads so the renderer gets the same
   * shape regardless of which path produced it.
   */
  function buildAvailabilityPayload(partial) {
    return {
      platformFlow,
      macQuarantineNotice,
      readyToInstall: downloadState.ready,
      ...partial,
    };
  }

  function persistLastKnown(payload) {
    lastKnownAvailable = payload;
    if (payload?.readyToInstall) {
      writeLastKnownSnapshot(app, payload);
    }
    return payload;
  }

  // -- electron-updater initialization (packaged macOS / Windows only) -------

  async function initAutoUpdater() {
    if (autoUpdater || updaterInitError) return autoUpdater;
    if (!inAppSupported) return null;
    try {
      if (typeof createAutoUpdater === "function") {
        autoUpdater = await createAutoUpdater();
      } else {
        // checkJs typeRoots omit this runtime dependency.
        // @ts-ignore
        const mod = await import("electron-updater");
        autoUpdater = mod.autoUpdater ?? mod.default?.autoUpdater ?? null;
      }
      if (!autoUpdater) {
        throw new Error("electron-updater did not expose an autoUpdater instance.");
      }
      if (typeof autoUpdater.setFeedURL === "function") {
        autoUpdater.setFeedURL({
          provider: "generic",
          url: resolveUpdateFeedUrl(),
        });
      }
      autoUpdater.allowPrerelease = true;
      applyUpdaterCacheDir(autoUpdater, resolveUserDataPath(app));
      // Check can run on a timer; download starts only when the user clicks.
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = false;
      autoUpdater.autoRunAppAfterInstall = true;

      autoUpdater.on("checking-for-update", () => {
        // No payload; renderer already shows its own checking state for
        // manual checks. Background poller is silent until a result.
      });

      autoUpdater.on("update-available", /** @param {any} info */ (info) => {
        const latestVersion =
          typeof info?.version === "string"
            ? info.version
            : String(info?.version ?? "").replace(/^v/i, "");
        const releaseNotes =
          typeof info?.releaseNotes === "string"
            ? info.releaseNotes
            : Array.isArray(info?.releaseNotes)
              ? info.releaseNotes
              : null;
        const isSeededReadyVersion =
          suppressAvailableVersion && suppressAvailableVersion === latestVersion;
        // A later check must not wipe an already-staged same-version package.
        const stagedVersion = String(
          downloadedUpdateInfo?.version ??
            downloadState.info?.version ??
            lastKnownAvailable?.latestVersion ??
            "",
        ).replace(/^v/i, "");
        const keepReady =
          (isSeededReadyVersion ||
            Boolean(downloadedUpdateInfo) ||
            downloadState.ready === true) &&
          (!stagedVersion || stagedVersion === latestVersion);
        if (keepReady) {
          downloadState = { ...downloadState, info, ready: true };
        } else {
          downloadState = {
            active: false,
            percent: 0,
            ready: false,
            info,
          };
        }
        const payload = buildAvailabilityPayload({
          available: true,
          currentVersion: resolveAppVersion(app),
          latestVersion: latestVersion || null,
          releaseTag: info?.releaseName ? String(info.releaseName) : latestVersion ? `v${latestVersion}` : null,
          releaseUrl: RELEASES_HTML_URL,
          releaseName: typeof info?.releaseName === "string" ? info.releaseName : null,
          releaseDate:
            typeof info?.releaseDate === "string"
              ? info.releaseDate
              : info?.releaseDate instanceof Date
                ? info.releaseDate.toISOString()
                : null,
          releaseNotes,
        });
        persistLastKnown(payload);
        if (!isSeededReadyVersion) {
          emitAvailable(payload);
          maybeNotify(latestVersion, payload);
        }
      });

      autoUpdater.on("download-progress", /** @param {any} progress */ (progress) => {
        const percent =
          typeof progress?.percent === "number" ? progress.percent : 0;
        // A real progress tick means this is not a cache-hit revalidation —
        // clear the seed suppress so a subsequent ready event can surface.
        if (suppressAvailableVersion && percent > 0 && percent < 100) {
          suppressAvailableVersion = null;
        }
        downloadState = {
          ...downloadState,
          active: percent < 100,
          percent,
          ready: false,
        };
        emitDownloadProgress({
          platformFlow,
          state: "downloading",
          percent,
          transferred:
            typeof progress?.transferred === "number" ? progress.transferred : 0,
          total: typeof progress?.total === "number" ? progress.total : 0,
          bytesPerSecond:
            typeof progress?.bytesPerSecond === "number"
              ? progress.bytesPerSecond
              : 0,
        });
      });

      autoUpdater.on("update-downloaded", /** @param {any} info */ (info) => {
        downloadedUpdateInfo = info ?? null;
        downloadState = { active: false, percent: 100, ready: true, info };
        notifyDownloadReady(info);
        const latestVersion =
          typeof info?.version === "string"
            ? info.version
            : String(info?.version ?? "").replace(/^v/i, "");
        const readyPayload = buildAvailabilityPayload({
          available: true,
          currentVersion: resolveAppVersion(app),
          latestVersion: latestVersion || lastKnownAvailable?.latestVersion || null,
          releaseTag: info?.releaseName ? String(info.releaseName) : latestVersion ? `v${latestVersion}` : null,
          releaseUrl: RELEASES_HTML_URL,
          releaseName: typeof info?.releaseName === "string" ? info.releaseName : null,
          releaseDate:
            typeof info?.releaseDate === "string"
              ? info.releaseDate
              : info?.releaseDate instanceof Date
                ? info.releaseDate.toISOString()
                : null,
          releaseNotes:
            typeof info?.releaseNotes === "string"
              ? info.releaseNotes
              : Array.isArray(info?.releaseNotes)
                ? info.releaseNotes
                : null,
          readyToInstall: true,
        });
        persistLastKnown(readyPayload);
        // The startup seeded state already showed the ready toast/progress; a
        // re-validation cache hit must not emit it twice. downloadedUpdateInfo
        // is still set above so installAndRestart can proceed.
        const alreadySeededReady =
          suppressAvailableVersion === latestVersion;
        suppressAvailableVersion = null;
        if (!alreadySeededReady) {
          emitAvailable(readyPayload);
          emitDownloadProgress({
            platformFlow,
            state: "ready",
            percent: 100,
            readyToInstall: true,
          });
          maybeNotify(latestVersion, readyPayload, true);
        }
      });

      autoUpdater.on("update-not-available", /** @param {any} info */ (info) => {
        downloadState = { active: false, percent: 0, ready: false, info: null };
        downloadedUpdateInfo = null;
        clearLastKnownSnapshot(app);
        const payload = buildAvailabilityPayload({
          available: false,
          currentVersion: resolveAppVersion(app),
          latestVersion:
            typeof info?.version === "string" ? info.version : null,
          reason: "You're up to date.",
          reasonCode: "up_to_date",
          soft: true,
          releaseUrl: RELEASES_HTML_URL,
        });
        persistLastKnown(payload);
      });

      autoUpdater.on("error", /** @param {Error} error */ (error) => {
        downloadState = { ...downloadState, active: false };
        const classified = classifyFetchError(error);
        const payload = buildAvailabilityPayload({
          available: false,
          currentVersion: resolveAppVersion(app),
          reason: classified.message,
          reasonCode: classified.code,
          soft: classified.soft,
          releaseUrl: RELEASES_HTML_URL,
        });
        // Keep a previous successful availability result for UI badges.
        if (!lastKnownAvailable?.latestVersion) {
          persistLastKnown(payload);
        }
        emitDownloadProgress({
          platformFlow,
          state: "error",
          error: classified.message,
        });
      });

      return autoUpdater;
    } catch (error) {
      updaterInitError = error;
      autoUpdater = null;
      return null;
    }
  }

  function maybeNotify(version, payload, isReady = false) {
    if (!version) return;
    if (lastNotifiedVersion === version && !isReady) return;
    lastNotifiedVersion = version;
    try {
      const copy = buildUpdateNotificationCopy({
        locale: resolveAppLocale(app),
        version,
        kind: isReady ? "ready" : "available",
      });
      showDesktopNotification(
        {
          title: copy.title,
          body: copy.body,
          force: true,
        },
        { getMainWindow, Notification },
      );
    } catch {
      // Notifications may fail on headless CI; ignore.
    }
  }

  // -- Fallback OSS yaml checker (Linux / dev / init failure) --------------

  /**
   * @param {{ silent: boolean }} options
   *   silent: when true, skip OS notification (manual Settings check).
   */
  async function performFallbackCheck({ silent }) {
    const currentVersion = resolveAppVersion(app);
    try {
      const release = await fetchLatestRelease({
        currentVersion,
        platform,
      });
      if (release?.notPublished) {
        return persistLastKnown(
          buildAvailabilityPayload({
            available: false,
            currentVersion,
            reason: "No releases have been published yet.",
            reasonCode: "not_published",
            soft: true,
            releaseUrl: RELEASES_HTML_URL,
          }),
        );
      }
      if (!release?.tagName) {
        return persistLastKnown(
          buildAvailabilityPayload({
            available: false,
            reason: "No release found.",
            reasonCode: "not_published",
            soft: true,
            currentVersion,
            releaseUrl: RELEASES_HTML_URL,
          }),
        );
      }
      const available = isVersionNewer(release.tagName, currentVersion);
      const payload = persistLastKnown(
        buildAvailabilityPayload({
          available,
          currentVersion,
          latestVersion: release.tagName.replace(/^v/i, ""),
          releaseTag: release.tagName,
          releaseUrl: release.htmlUrl,
          releaseName: release.name,
          releaseDate: release.publishedAt,
          releaseNotes: release.body,
        }),
      );
      if (available) {
        emitAvailable(payload);
        if (!silent && lastNotifiedVersion !== release.tagName) {
          lastNotifiedVersion = release.tagName;
          try {
            if (Notification?.isSupported?.()) {
              const copy = buildUpdateNotificationCopy({
                locale: resolveAppLocale(app),
                version: payload.latestVersion,
                kind: "fallback",
              });
              const notification = new Notification({
                title: copy.title,
                body: copy.body,
                silent: false,
              });
              notification.on("click", () => openReleasePage(release.htmlUrl));
              notification.show();
            }
          } catch {
            // ignore
          }
        }
      }
      return payload;
    } catch (error) {
      const classified = classifyFetchError(error);
      const payload = buildAvailabilityPayload({
        available: false,
        currentVersion,
        reason: classified.message,
        reasonCode: classified.code,
        soft: classified.soft,
        releaseUrl: RELEASES_HTML_URL,
      });
      if (!lastKnownAvailable?.latestVersion) {
        persistLastKnown(payload);
      }
      return payload;
    }
  }

  async function performCheck(options) {
    if (autoUpdater) {
      try {
        await autoUpdater.checkForUpdates();
        return (
          lastKnownAvailable ??
          buildAvailabilityPayload({
            available: false,
            currentVersion: resolveAppVersion(app),
          })
        );
      } catch (error) {
        // If electron-updater's check throws, fall through to the API checker.
        const classified = classifyFetchError(error);
        const payload = buildAvailabilityPayload({
          available: false,
          currentVersion: resolveAppVersion(app),
          reason: classified.message,
          reasonCode: classified.code,
          soft: classified.soft,
          releaseUrl: RELEASES_HTML_URL,
        });
        if (!lastKnownAvailable?.latestVersion) persistLastKnown(payload);
        return payload;
      }
    }
    return performFallbackCheck(options);
  }

  // -- IPC handlers ----------------------------------------------------------

  ipcMain.handle("onmyagent:updater:getChannel", async () =>
    channelState(app, platformFlow),
  );

  ipcMain.handle("onmyagent:updater:setAutoCheck", async (_event, enabled) => {
    const autoCheck = enabled === true;
    autoCheckEnabled = autoCheck;
    writePersistedUpdaterAutoCheck(resolveUserDataPath(app), autoCheck);
    if (autoUpdater) autoUpdater.autoDownload = false;
    clearAutoChecks();
    scheduleAutoChecks();
    return { autoCheck };
  });

  ipcMain.handle("onmyagent:updater:getAutoCheck", async () => ({
    autoCheck: autoCheckEnabled,
  }));

  ipcMain.handle(
    "onmyagent:updater:setChannel",
    async (_event, rawChannel) => {
      const state = channelState(app, platformFlow);
      const requested =
        rawChannel === "alpha" || rawChannel === "stable"
          ? rawChannel
          : "stable";
      return {
        ...state,
        requestedChannel: requested,
        reason:
          requested === "alpha"
            ? "Alpha channel is not supported by the updater."
            : undefined,
      };
    },
  );

  ipcMain.handle("onmyagent:updater:check", async () => {
    const result = await performCheck({ silent: true });
    return {
      ...result,
      channel: "stable",
      feedUrl: RELEASES_HTML_URL,
    };
  });

  ipcMain.handle("onmyagent:updater:getLastKnown", async () => {
    if (lastKnownAvailable) return lastKnownAvailable;
    return buildAvailabilityPayload({
      available: false,
      currentVersion: resolveAppVersion(app),
    });
  });

  // In-app path: start (or resume) the electron-updater download.
  // Fallback path: open the OSS installer URL in the browser.
  ipcMain.handle("onmyagent:updater:download", async () => {
    if (downloadState.ready) {
      return { ok: true, readyToInstall: true, platformFlow };
    }
    if (autoUpdater) {
      try {
        if (!downloadState.active) {
          downloadState = { ...downloadState, active: true, percent: 0 };
          emitDownloadProgress({
            platformFlow,
            state: "downloading",
            percent: 0,
          });
          // fire-and-forget; events drive progress/ready state
          void autoUpdater.downloadUpdate().catch((error) => {
            downloadState = { ...downloadState, active: false };
            emitDownloadProgress({
              platformFlow,
              state: "error",
              error: classifyFetchError(error).message,
            });
          });
        }
        return { ok: true, platformFlow, downloading: true };
      } catch (error) {
        return {
          ok: false,
          reason: classifyFetchError(error).message,
          platformFlow,
        };
      }
    }
    // Fallback: browser.
    try {
      const release = await fetchLatestRelease({
        currentVersion: resolveAppVersion(app),
        platform,
      });
      openReleasePage(release?.htmlUrl);
      return { ok: true, platformFlow };
    } catch (error) {
      openReleasePage(RELEASES_HTML_URL);
      return {
        ok: true,
        reason: classifyFetchError(error).message,
        platformFlow,
      };
    }
  });

  // In-app path: quit and install the downloaded update.
  // Never fires in unpackaged/dev builds.
  ipcMain.handle("onmyagent:updater:installAndRestart", async () => {
    if (!app.isPackaged || !autoUpdater) {
      // Dev / fallback: open the release page instead of pretending to install.
      openReleasePage(RELEASES_HTML_URL);
      return { ok: true, reason: "opened-release-page", platformFlow };
    }
    // Seeded UI-ready path: checkForUpdates() with autoDownload=false never
    // emits update-downloaded. downloadUpdate() cache-hits the staged package
    // and wires quitAndInstall.
    if (!downloadedUpdateInfo && downloadState.ready) {
      await ensurePendingUpdateWired();
    }
    if (!downloadedUpdateInfo) {
      const stillDownloading = downloadState.active === true;
      return {
        ok: false,
        reason: stillDownloading
          ? "The update is still downloading. Try again when it finishes."
          : downloadState.ready
            ? "Update package is still being verified. Try again in a moment."
            : "Update has not finished downloading yet.",
        reasonCode: stillDownloading
          ? "still_downloading"
          : downloadState.ready
            ? "still_verifying"
            : "not_downloaded",
        platformFlow,
      };
    }
    try {
      // Detached Task Supervisor is another OnMyAgent.exe. Drain and kill it
      // before NSIS old-uninstaller or the install blocks on a live process.
      if (typeof prepareForUpdateInstall === "function") {
        await prepareForUpdateInstall();
      }
      // Signal main's before-quit not to preventDefault — otherwise
      // Task Supervisor drain keeps the window alive and the user can
      // click Restart again while electron-updater is already quitting.
      quitForUpdateRequested = true;
      // isSilent=false (show installer UI on Windows), isForceRunAfter=true.
      autoUpdater.quitAndInstall(false, true);
      return { ok: true, platformFlow };
    } catch (error) {
      quitForUpdateRequested = false;
      return {
        ok: false,
        reason: classifyFetchError(error).message,
        platformFlow,
      };
    }
  });

  let scheduledInitial = null;
  let intervalHandle = null;

  function clearAutoChecks() {
    if (scheduledInitial) {
      clearTimeout(scheduledInitial);
      scheduledInitial = null;
    }
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  function scheduleAutoChecks() {
    if (scheduledInitial || intervalHandle) return;
    const flags = {
      packaged: Boolean(app.isPackaged),
      autoCheck: autoCheckEnabled,
      devDisabled: UPDATE_CHECK_IN_DEV_DISABLED,
    };
    if (shouldScheduleColdStartCheck(flags)) {
      scheduledInitial = setTimeout(() => {
        scheduledInitial = null;
        void performCheck({ silent: false });
      }, INITIAL_CHECK_DELAY_MS);
      if (typeof scheduledInitial?.unref === "function") scheduledInitial.unref();
    }
    if (shouldScheduleAutoChecks(flags)) {
      intervalHandle = setInterval(() => {
        void performCheck({ silent: false });
      }, CHECK_INTERVAL_MS);
      if (typeof intervalHandle?.unref === "function") intervalHandle.unref();
    }
  }

  app.on("before-quit", () => {
    clearAutoChecks();
  });

  return {
    ensureAutoUpdater: async () => {
      const initialized = await initAutoUpdater();
      // If initialization failed on a platform that should support in-app
      // updates, fall back to the API checker (scheduleAutoChecks routes via
      // performCheck, which uses whatever is available).
      scheduleAutoChecks();
      // If a download finished in a previous launch, wire electron-updater's
      // pending cache immediately. autoDownload is false, so this must call
      // downloadUpdate() (cache hit) — checkForUpdates() never emits
      // update-downloaded. Renderer startup already reads seeded getLastKnown()
      // so the toast appears without waiting for this.
      if (inAppSupported && downloadState.ready && autoUpdater) {
        ensurePendingUpdateWired().catch((error) => {
          console.warn("[updater] startup revalidation failed", error);
        });
      }
      return initialized;
    },
    checkForUpdatesNow: () => performCheck({ silent: false }),
  };
}
