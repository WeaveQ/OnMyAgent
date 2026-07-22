import { unwatchFile, watchFile } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const OFFICE_EXTENSIONS = new Set([
  ".doc", ".docx", ".docm", ".dot", ".dotx", ".dotm", ".rtf", ".odt",
  ".xls", ".xlsx", ".xlsm", ".xlsb", ".xlt", ".xltx", ".xltm", ".ods", ".fods",
  ".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".ppsm", ".pot", ".potx", ".potm", ".odp",
]);
const NATIVE_FILE_EXTENSIONS = new Set([".pdf", ".mp3", ".mp4"]);

function previewKind(extension) {
  return extension === ".pdf" ? "pdf" : NATIVE_FILE_EXTENSIONS.has(extension) ? "media" : "office";
}

function normalizedForComparison(value) {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithinRoot(filePath, rootPath) {
  const file = normalizedForComparison(filePath);
  const root = normalizedForComparison(rootPath);
  const relative = path.relative(root, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeBounds(value) {
  const input = value && typeof value === "object" ? value : {};
  const number = (key) => {
    const candidate = Number(input[key]);
    return Number.isFinite(candidate) ? Math.max(0, Math.round(candidate)) : 0;
  };
  return { x: number("x"), y: number("y"), width: number("width"), height: number("height") };
}

export function createArtifactPreviewController(options) {
  if (typeof options?.WebContentsView !== "function") throw new TypeError("WebContentsView is required");
  if (typeof options?.listWorkspaceRoots !== "function") throw new TypeError("listWorkspaceRoots is required");

  let mainWindow = null;
  let view = null;
  let visible = false;
  let bounds = null;
  let activePath = null;
  let activeTarget = null;
  let activePayload = null;
  let intentVersion = 0;
  let watchedPath = null;
  let refreshTimer = null;

  const watchPath = options.watchFile ?? watchFile;
  const unwatchPath = options.unwatchFile ?? unwatchFile;
  const schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancelScheduled = options.cancelScheduled ?? clearTimeout;

  function windowAlive() {
    return Boolean(mainWindow && !mainWindow.isDestroyed?.() && mainWindow.contentView);
  }

  function detach() {
    if (!view || !windowAlive()) return;
    const children = mainWindow.contentView.children;
    if (Array.isArray(children) && children.includes(view)) mainWindow.contentView.removeChildView(view);
  }

  function attach() {
    if (!view || !visible || !windowAlive() || !bounds || bounds.width < 1 || bounds.height < 1) return;
    if (!mainWindow.contentView.children.includes(view)) mainWindow.contentView.addChildView(view);
    view.setBounds(bounds);
  }

  function clearRefreshTimer() {
    if (refreshTimer === null) return;
    cancelScheduled(refreshTimer);
    refreshTimer = null;
  }

  function stopWatching() {
    clearRefreshTimer();
    if (!watchedPath) return;
    unwatchPath(watchedPath);
    watchedPath = null;
  }

  function destroyView() {
    stopWatching();
    detach();
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
    view = null;
    activePath = null;
    activeTarget = null;
    activePayload = null;
  }

  async function validateFile(requestedPath) {
    if (typeof requestedPath !== "string" || !path.isAbsolute(requestedPath)) {
      throw new Error("Artifact preview requires an absolute local file path.");
    }
    const [candidate, roots] = await Promise.all([
      realpath(requestedPath),
      options.listWorkspaceRoots(),
    ]);
    const realRoots = await Promise.all(
      roots.filter((root) => typeof root === "string" && root.trim()).map((root) => realpath(root)),
    );
    if (!realRoots.some((root) => isWithinRoot(candidate, root))) {
      throw new Error("Artifact preview is limited to registered local workspaces.");
    }
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error("Artifact preview target is not a file.");
    const extension = path.extname(candidate).toLowerCase();
    if (!NATIVE_FILE_EXTENSIONS.has(extension) && !OFFICE_EXTENSIONS.has(extension)) {
      throw new Error(`Unsupported artifact preview type: ${extension || "unknown"}`);
    }
    return { filePath: candidate, extension, size: info.size, mtimeMs: info.mtimeMs };
  }

  function officeViewerUrl() {
    const start = process.env.ONMYAGENT_ELECTRON_START_URL?.trim() || process.env.ELECTRON_START_URL?.trim();
    if (start) return new URL("/office-viewer.html", start).toString();
    return pathToFileURL(path.join(process.resourcesPath, "app-dist", "office-viewer.html")).href;
  }

  function scheduleRefresh(version, attempt = 0) {
    clearRefreshTimer();
    refreshTimer = schedule(async () => {
      refreshTimer = null;
      await refreshActiveFile(version, attempt);
    }, attempt === 0 ? 250 : 200);
  }

  async function refreshActiveFile(version, attempt) {
    const filePath = activePath;
    if (!filePath || !view || version !== intentVersion || view.webContents.isDestroyed()) return;
    try {
      const target = await validateFile(filePath);
      if (!view || version !== intentVersion || activePath !== filePath || view.webContents.isDestroyed()) return;
      if (activeTarget && target.mtimeMs === activeTarget.mtimeMs && target.size === activeTarget.size) return;
      if (NATIVE_FILE_EXTENSIONS.has(target.extension)) {
        activeTarget = target;
        await view.webContents.reloadIgnoringCache();
        return;
      }
      const bytes = await readFile(target.filePath);
      if (!view || version !== intentVersion || activePath !== filePath || view.webContents.isDestroyed()) return;
      activeTarget = target;
      activePayload = {
        ...activePayload,
        bytes: new Uint8Array(bytes),
        name: path.basename(target.filePath),
        extension: target.extension,
        size: target.size,
        mtimeMs: target.mtimeMs,
      };
      view.webContents.send("onmyagent:artifact-preview:file", activePayload);
    } catch {
      if (version === intentVersion && activePath === filePath && attempt < 3) {
        scheduleRefresh(version, attempt + 1);
      }
    }
  }

  function startWatching(filePath, version) {
    stopWatching();
    watchedPath = filePath;
    watchPath(filePath, { interval: 500 }, (current, previous) => {
      if (version !== intentVersion || activePath !== filePath) return;
      if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return;
      scheduleRefresh(version);
    });
  }

  async function show(request) {
    const version = ++intentVersion;
    const target = await validateFile(request?.filePath);
    if (version !== intentVersion) return { ok: false, stale: true };
    bounds = safeBounds(request?.bounds);
    visible = true;
    if (view && activePath === target.filePath) {
      startWatching(target.filePath, version);
      if (activeTarget && (target.mtimeMs !== activeTarget.mtimeMs || target.size !== activeTarget.size)) {
        scheduleRefresh(version);
      }
      attach();
      return { ok: true, kind: previewKind(target.extension) };
    }

    destroyView();
    activePath = target.filePath;
    activeTarget = target;
    const isNativeFile = NATIVE_FILE_EXTENSIONS.has(target.extension);
    view = new options.WebContentsView({
      webPreferences: {
        backgroundThrottling: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: "persist:onmyagent-artifact-preview",
        ...(isNativeFile ? {} : { preload: options.preloadPath }),
      },
    });
    view.webContents.setWindowOpenHandler?.(() => ({ action: "deny" }));
    view.webContents.on?.("will-navigate", (event, url) => {
      const allowed = isNativeFile ? url === pathToFileURL(target.filePath).href : url === officeViewerUrl();
      if (!allowed) event.preventDefault();
    });
    attach();
    if (isNativeFile) {
      await view.webContents.loadURL(pathToFileURL(target.filePath).href);
    } else {
      const bytes = await readFile(target.filePath);
      activePayload = {
        bytes: new Uint8Array(bytes),
        name: path.basename(target.filePath),
        extension: target.extension,
        size: target.size,
        mtimeMs: target.mtimeMs,
        theme: request?.theme === "dark" ? "dark" : "light",
        locale: typeof request?.locale === "string" ? request.locale : "en",
      };
      view.webContents.once("did-finish-load", () => {
        if (version !== intentVersion || !view || view.webContents.isDestroyed() || activePath !== target.filePath) return;
        view.webContents.send("onmyagent:artifact-preview:file", activePayload);
      });
      await view.webContents.loadURL(officeViewerUrl());
      if (version !== intentVersion) return { ok: false, stale: true };
    }
    if (version === intentVersion && activePath === target.filePath) startWatching(target.filePath, version);
    return { ok: true, kind: previewKind(target.extension) };
  }

  async function openForEditing(request) {
    if (typeof options.openPath !== "function") throw new TypeError("openPath is required");
    const target = await validateFile(request?.filePath);
    const error = await options.openPath(target.filePath);
    if (typeof error === "string" && error.trim()) throw new Error(error);
    return { ok: true };
  }

  return {
    setMainWindow(window) { mainWindow = window; attach(); },
    show,
    openForEditing,
    hide() { intentVersion += 1; visible = false; detach(); },
    setBounds(nextBounds) { bounds = safeBounds(nextBounds); attach(); },
    sendFileTo(sender) {
      if (!view || !activePayload || sender?.id !== view.webContents.id) return false;
      sender.send("onmyagent:artifact-preview:file", activePayload);
      return true;
    },
    destroy() { intentVersion += 1; visible = false; bounds = null; destroyView(); },
  };
}

export const artifactPreviewInternals = {
  isWithinRoot,
  safeBounds,
  OFFICE_EXTENSIONS,
  NATIVE_FILE_EXTENSIONS,
};
