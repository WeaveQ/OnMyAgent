import { isElectronRuntime } from "@/app/utils";

/**
 * Same sequence as clicking a localhost link in the transcript:
 * 1) expand the right side panel to "browser"
 * 2) create/select a page tab for the URL when provided (session-scoped)
 *
 * Agent automation must reach the same UI effect (via panel-opened / state),
 * not only create a WebContentsView in the main process.
 */
export async function openInAppBrowser(input: {
  openSidePanel: () => void;
  url?: string | null;
  sessionId?: string | null;
}): Promise<{ tabId?: string }> {
  input.openSidePanel();

  if (!isElectronRuntime()) {
    if (input.url) {
      window.open(input.url, "_blank", "noopener,noreferrer");
    }
    return {};
  }

  const browser = window.__ONMYAGENT_ELECTRON__?.browser;
  if (!browser) {
    throw new Error("Browser bridge is unavailable.");
  }

  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!url) return {};

  const createTab = browser.createTab;
  if (!createTab) {
    throw new Error("Browser createTab is unavailable.");
  }
  const sessionId =
    typeof input.sessionId === "string" && input.sessionId.trim()
      ? input.sessionId.trim()
      : undefined;
  const created = await createTab(url, sessionId ? { sessionId } : undefined);
  return { tabId: created?.tabId };
}
