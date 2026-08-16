/**
 * Main-process desktop notification helper. Electron 42+ emits `failed`
 * (unsigned macOS / UNNotification) instead of throwing — swallow that
 * and return a result so the process does not crash.
 *
 * @param {{
 *   title?: string | null,
 *   body?: string | null,
 *   force?: boolean,
 *   href?: string | null,
 * } | null | undefined} input
 * @param {{
 *   getMainWindow?: () => { isDestroyed?: () => boolean, isFocused?: () => boolean, isMinimized?: () => boolean, restore?: () => void, show?: () => void, focus?: () => void, webContents?: { executeJavaScript?: (code: string) => Promise<unknown> } } | null | undefined,
 *   Notification?: (new (opts: { title: string, body: string, silent?: boolean }) => {
 *     on?: (event: string, handler: (...args: unknown[]) => void) => void,
 *     show: () => void,
 *   }) & { isSupported?: () => boolean },
 * }} [options]
 * @returns {{
 *   ok: boolean,
 *   skipped?: boolean,
 *   reason?: string,
 *   error?: string,
 * }}
 */
export function showDesktopNotification(input, options = {}) {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const body = typeof input?.body === "string" ? input.body : "";
  const force = input?.force === true;
  const href = typeof input?.href === "string" ? input.href.trim() : "";

  if (!title) {
    return { ok: false, error: "missing_title" };
  }

  try {
    const NotificationImpl = options.Notification;
    if (typeof NotificationImpl !== "function") {
      return { ok: false, error: "missing_notification" };
    }
    if (typeof NotificationImpl.isSupported === "function" && !NotificationImpl.isSupported()) {
      return { ok: false, error: "unsupported" };
    }

    const getMainWindow = options.getMainWindow;
    const mainWindow =
      typeof getMainWindow === "function" ? (getMainWindow() ?? null) : null;

    if (
      !force &&
      mainWindow &&
      !mainWindow.isDestroyed() &&
      mainWindow.isFocused()
    ) {
      return { ok: true, skipped: true, reason: "focused" };
    }

    const notification = new NotificationImpl({
      title,
      body: body || "",
      silent: false,
    });

    let failedError = null;
    if (typeof notification.on === "function") {
      notification.on("failed", (_event, error) => {
        failedError = error ?? "failed";
      });
    }

    if (typeof notification.on === "function") {
      notification.on("click", () => {
        try {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
          if (href) {
            const script = `(function(){try{window.history.pushState(null,"",${JSON.stringify(href)});window.dispatchEvent(new PopStateEvent("popstate"));}catch(_){}})();`;
            void mainWindow.webContents?.executeJavaScript?.(script)?.catch(() => undefined);
          }
        } catch {
          // ignore click handler failures
        }
      });
    }

    notification.show();
    if (failedError) {
      return { ok: false, error: String(failedError) };
    }
    return { ok: true, skipped: false };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
