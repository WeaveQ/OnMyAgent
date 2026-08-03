/**
 * Frameless quick-capture panel for global shortcut dispatch.
 * Lightweight static HTML + narrow preload; submit routes through main → main window.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const QUICK_CAPTURE_SUBMIT_EVENT = "onmyagent:quick-capture:submit";
export const QUICK_CAPTURE_OPEN_EVENT = "onmyagent:quick-capture:open";

/**
 * @param {object} input
 * @param {typeof import("electron").BrowserWindow} input.BrowserWindow
 * @param {() => Promise<import("electron").BrowserWindow | null | undefined> | import("electron").BrowserWindow | null | undefined} input.getMainWindow
 * @param {() => Promise<import("electron").BrowserWindow>} [input.createMainWindow]
 * @param {() => {
 *   workspaceLabel?: string;
 *   modelLabel?: string;
 *   selectedProviderID?: string;
 *   selectedModelID?: string;
 *   models?: Array<{ providerID: string; modelID: string; title: string; disabled?: boolean }>;
 * }} [input.getCaptureContext]
 * @param {string} [input.preloadPath]
 * @param {string} [input.htmlPath]
 */
export function createQuickCaptureWindowController(input) {
  const {
    BrowserWindow,
    getMainWindow,
    createMainWindow,
    getCaptureContext = () => ({}),
  } = input;

  const preloadPath =
    input.preloadPath ?? path.join(__dirname, "quick-capture-preload.cjs");
  const htmlPath =
    input.htmlPath ??
    path.join(__dirname, "../resources/quick-capture/index.html");

  /** @type {import("electron").BrowserWindow | null} */
  let captureWindow = null;

  function resolveHtmlPath() {
    if (existsSync(htmlPath)) return htmlPath;
    const alt = path.join(__dirname, "../resources/quick-capture.html");
    return existsSync(alt) ? alt : htmlPath;
  }

  function isVisible() {
    return Boolean(captureWindow && !captureWindow.isDestroyed() && captureWindow.isVisible());
  }

  function hide() {
    if (!captureWindow || captureWindow.isDestroyed()) return;
    // Destroy on hide so the next open always loads the latest static HTML.
    captureWindow.destroy();
    captureWindow = null;
  }

  function destroy() {
    if (!captureWindow || captureWindow.isDestroyed()) {
      captureWindow = null;
      return;
    }
    captureWindow.destroy();
    captureWindow = null;
  }

  function ensureWindow() {
    if (captureWindow && !captureWindow.isDestroyed()) return captureWindow;

    captureWindow = new BrowserWindow({
      width: 520,
      height: 220,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      transparent: true,
      backgroundColor: "#00000000",
      hasShadow: true,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    captureWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    captureWindow.on("blur", () => {
      // Delay: native <select> menus briefly steal focus and would otherwise
      // destroy the panel before the user can pick a model.
      setTimeout(() => {
        if (!captureWindow || captureWindow.isDestroyed()) return;
        if (captureWindow.isFocused()) return;
        hide();
      }, 180);
    });
    captureWindow.on("closed", () => {
      captureWindow = null;
    });

    void captureWindow.loadFile(resolveHtmlPath());
    return captureWindow;
  }

  async function show() {
    const win = ensureWindow();
    // Center relative to primary display cursor-ish: use screen center.
    try {
      const { screen } = await import("electron");
      const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
      const { width, height, x, y } = display.workArea;
      const bounds = win.getBounds();
      win.setPosition(
        Math.round(x + (width - bounds.width) / 2),
        Math.round(y + height * 0.28),
      );
    } catch {
      // ignore placement errors
    }

    const context = getCaptureContext() ?? {};
    try {
      win.webContents.send("onmyagent:quick-capture:context", context);
    } catch {
      // window may still be loading
    }

    if (!win.isVisible()) win.show();
    win.focus();
    try {
      win.webContents.send("onmyagent:quick-capture:focus");
    } catch {
      // ignore
    }
    return win;
  }

  async function toggle() {
    if (isVisible()) {
      hide();
      return { open: false };
    }
    await show();
    return { open: true };
  }

  /**
   * Forward capture submit to the main renderer and hide the panel.
   * @param {{ text?: string; mode?: string; model?: { providerID?: string; modelID?: string } }} payload
   */
  async function submit(payload) {
    const text = String(payload?.text ?? "").trim();
    const mode = String(payload?.mode ?? "agent").trim() || "agent";
    const providerID = String(payload?.model?.providerID ?? "").trim();
    const modelID = String(payload?.model?.modelID ?? "").trim();
    const model =
      providerID && modelID ? { providerID, modelID } : undefined;
    hide();
    if (!text) return { ok: false, error: "empty" };

    let mainWin =
      typeof getMainWindow === "function" ? await getMainWindow() : getMainWindow;
    if ((!mainWin || mainWin.isDestroyed()) && typeof createMainWindow === "function") {
      mainWin = await createMainWindow();
    }
    if (!mainWin || mainWin.isDestroyed()) {
      return { ok: false, error: "no-main-window" };
    }
    if (mainWin.isMinimized()) mainWin.restore();
    if (!mainWin.isVisible()) mainWin.show();
    mainWin.focus();
    mainWin.webContents.send(QUICK_CAPTURE_SUBMIT_EVENT, { text, mode, model });
    return { ok: true };
  }

  return {
    ensureWindow,
    show,
    hide,
    destroy,
    toggle,
    submit,
    isVisible,
    QUICK_CAPTURE_SUBMIT_EVENT,
  };
}
