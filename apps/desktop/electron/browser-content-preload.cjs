const { ipcRenderer } = require("electron");

const BROWSER_TAB_ARGUMENT_PREFIX = "--onmyagent-browser-tab-id=";
const browserTabArgument = process.argv.find((entry) =>
  String(entry).startsWith(BROWSER_TAB_ARGUMENT_PREFIX),
);
if (browserTabArgument) {
  const encodedTabId = String(browserTabArgument).slice(
    BROWSER_TAB_ARGUMENT_PREFIX.length,
  );
  try {
    window.name = `onmyagent-browser:${decodeURIComponent(encodedTabId)}`;
  } catch {
    // Ignore malformed internal arguments and leave the page unmarked.
  }
}

function dismissMenuOverlay() {
  ipcRenderer.send("onmyagent:menu-overlay:dismiss");
}

function installDismissListeners() {
  window.addEventListener("pointerdown", dismissMenuOverlay, { capture: true });
  window.addEventListener("wheel", dismissMenuOverlay, { capture: true, passive: true });
  window.addEventListener("keydown", dismissMenuOverlay, { capture: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", installDismissListeners, { once: true });
} else {
  installDismissListeners();
}
