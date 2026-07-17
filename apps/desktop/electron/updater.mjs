import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Lightweight update checker: query GitHub Releases API and, when a newer
// version is available, notify the user and (on click) open the release
// page in the default browser. No download, no in-place install — keeps
// the update surface simple and portable across macOS / Windows / Linux
// with zero code-signing requirements for the update flow itself.

const RELEASES_LATEST_API =
  "https://api.github.com/repos/WeaveQ/onmyagent/releases/latest";
const RELEASES_HTML_URL =
  "https://github.com/WeaveQ/onmyagent/releases/latest";
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const INITIAL_CHECK_DELAY_MS = 30 * 1000; // 30s
const FETCH_TIMEOUT_MS = 10 * 1000;

const __updater_dirname = path.dirname(fileURLToPath(import.meta.url));
let _cachedAppVersion = null;

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

async function fetchLatestRelease() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(RELEASES_LATEST_API, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "OnMyAgent-UpdateChecker",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`GitHub API responded ${response.status}`);
    }
    const data = await response.json();
    return {
      tagName: typeof data?.tag_name === "string" ? data.tag_name : null,
      htmlUrl: typeof data?.html_url === "string" ? data.html_url : RELEASES_HTML_URL,
      name: typeof data?.name === "string" ? data.name : null,
      publishedAt: typeof data?.published_at === "string" ? data.published_at : null,
      body: typeof data?.body === "string" ? data.body : null,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function registerUpdaterIpc({ app, ipcMain, getMainWindow, Notification, shell }) {
  let lastNotifiedVersion = null;

  function openReleasePage(url) {
    const target = url || RELEASES_HTML_URL;
    if (shell?.openExternal) {
      shell.openExternal(target).catch(() => undefined);
    }
  }

  async function performCheck({ silent }) {
    const currentVersion = resolveAppVersion(app);
    try {
      const release = await fetchLatestRelease();
      if (!release?.tagName) {
        return {
          available: false,
          reason: "No release found.",
          currentVersion,
        };
      }
      const available = isVersionNewer(release.tagName, currentVersion);
      const payload = {
        available,
        currentVersion,
        latestVersion: release.tagName.replace(/^v/i, ""),
        releaseTag: release.tagName,
        releaseUrl: release.htmlUrl,
        releaseName: release.name,
        releaseDate: release.publishedAt,
        releaseNotes: release.body,
      };
      if (available && !silent && lastNotifiedVersion !== release.tagName) {
        lastNotifiedVersion = release.tagName;
        try {
          if (Notification?.isSupported?.()) {
            const notification = new Notification({
              title: "OnMyAgent update available",
              body: `Version ${payload.latestVersion} is available. Click to open the release page.`,
              silent: false,
            });
            notification.on("click", () => openReleasePage(release.htmlUrl));
            notification.show();
          }
        } catch {
          // Notifications may fail on headless CI; ignore.
        }
        try {
          const win = typeof getMainWindow === "function" ? getMainWindow() : null;
          if (win?.webContents && !win.isDestroyed()) {
            win.webContents.send("onmyagent:updater:available", payload);
          }
        } catch {
          // Renderer may be gone; ignore.
        }
      }
      return payload;
    } catch (error) {
      return {
        available: false,
        currentVersion,
        reason: String(error?.message ?? error),
      };
    }
  }

  ipcMain.handle("onmyagent:updater:getChannel", async () => ({
    channel: "stable",
    feedUrl: RELEASES_HTML_URL,
    currentVersion: resolveAppVersion(app),
  }));

  ipcMain.handle("onmyagent:updater:setChannel", async () => ({
    channel: "stable",
    feedUrl: RELEASES_HTML_URL,
    currentVersion: resolveAppVersion(app),
  }));

  ipcMain.handle("onmyagent:updater:check", async () => {
    const result = await performCheck({ silent: false });
    return {
      ...result,
      channel: "stable",
      feedUrl: RELEASES_HTML_URL,
    };
  });

  // Legacy download IPC: instead of downloading in-app, open the browser to
  // the release page so the user can grab the appropriate installer.
  ipcMain.handle("onmyagent:updater:download", async () => {
    try {
      const release = await fetchLatestRelease();
      openReleasePage(release?.htmlUrl);
      return { ok: true };
    } catch (error) {
      openReleasePage(RELEASES_HTML_URL);
      return { ok: true, reason: String(error?.message ?? error) };
    }
  });

  // Legacy install IPC: no-op with browser fallback so old renderer code
  // paths keep working during the migration.
  ipcMain.handle("onmyagent:updater:installAndRestart", async () => {
    openReleasePage(RELEASES_HTML_URL);
    return { ok: true };
  });

  let scheduledInitial = null;
  let intervalHandle = null;

  function scheduleAutoChecks() {
    if (scheduledInitial || intervalHandle) return;
    scheduledInitial = setTimeout(() => {
      scheduledInitial = null;
      void performCheck({ silent: false });
    }, INITIAL_CHECK_DELAY_MS);
    intervalHandle = setInterval(() => {
      void performCheck({ silent: false });
    }, CHECK_INTERVAL_MS);
    if (typeof intervalHandle?.unref === "function") intervalHandle.unref();
    if (typeof scheduledInitial?.unref === "function") scheduledInitial.unref();
  }

  app.on("before-quit", () => {
    if (scheduledInitial) clearTimeout(scheduledInitial);
    if (intervalHandle) clearInterval(intervalHandle);
  });

  return {
    ensureAutoUpdater: async () => {
      scheduleAutoChecks();
      return null;
    },
    checkForUpdatesNow: () => performCheck({ silent: false }),
  };
}
