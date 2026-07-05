import { contextBridge, ipcRenderer, webUtils } from "electron";

const NATIVE_DEEP_LINK_EVENT = "onmyagent:deep-link-native";
const NATIVE_MENU_OPEN_SETTINGS_EVENT = "onmyagent:native-menu:open-settings";
const NATIVE_MENU_TOGGLE_SIDEBAR_EVENT = "onmyagent:native-menu:toggle-sidebar";
const DESKTOP_IPC_CHANNEL = "onmyagent:desktop";
const LEGACY_DESKTOP_IPC_CHANNEL = "open" + "work:desktop";

function normalizePlatform(value) {
  if (value === "darwin" || value === "linux") return value;
  if (value === "win32") return "windows";
  return "linux";
}

function applyShellDocumentMarkers() {
  try {
    const root = document?.documentElement;
    if (!root) return false;

    root.dataset.onmyagentShell = "electron";
    root.classList.add("onmyagent-electron");
    if (process.platform === "darwin") {
      root.classList.add("onmyagent-platform-mac");
    } else if (process.platform === "win32") {
      root.classList.add("onmyagent-platform-windows");
    } else if (process.platform === "linux") {
      root.classList.add("onmyagent-platform-linux");
    }
    return true;
  } catch {
    return false;
  }
}

function notifyMenuOverlayDismiss() {
  ipcRenderer.send("onmyagent:menu-overlay:dismiss");
}

function installMenuOverlayDismissListeners() {
  try {
    const target = window;
    target.addEventListener("pointerdown", notifyMenuOverlayDismiss, { capture: true });
    target.addEventListener("wheel", notifyMenuOverlayDismiss, { capture: true, passive: true });
    target.addEventListener("keydown", notifyMenuOverlayDismiss, { capture: true });
    return true;
  } catch {
    return false;
  }
}

contextBridge.exposeInMainWorld("__ONMYAGENT_ELECTRON__", {
  invokeDesktop(command, ...args) {
    return ipcRenderer.invoke(DESKTOP_IPC_CHANNEL, command, ...args).catch((error) => {
      if (error?.message?.includes("No handler registered for 'onmyagent:desktop'")) {
        return ipcRenderer.invoke(LEGACY_DESKTOP_IPC_CHANNEL, command, ...args);
      }
      throw error;
    });
  },
  files: {
    getPathForFile(file) {
      try {
        return webUtils.getPathForFile(file) || null;
      } catch {
        return null;
      }
    },
  },
  shell: {
    openExternal(url) {
      return ipcRenderer.invoke("onmyagent:shell:openExternal", url);
    },
    relaunch() {
      return ipcRenderer.invoke("onmyagent:shell:relaunch");
    },
  },
  system: {
    getArchitectureInfo() {
      return ipcRenderer.invoke("onmyagent:system:architecture");
    },
  },
  dev: {
    openInEditor(request) {
      return ipcRenderer.invoke("onmyagent:dev:openInEditor", request);
    },
  },
  softwareEnvironment: {
    onProgress(callback) {
      const handler = (_event, progress) => callback(progress);
      ipcRenderer.on("onmyagent:software-env:progress", handler);
      return () => {
        ipcRenderer.removeListener("onmyagent:software-env:progress", handler);
      };
    },
  },
  migration: {
    readSnapshot() {
      return ipcRenderer.invoke("onmyagent:migration:read");
    },
    ackSnapshot() {
      return ipcRenderer.invoke("onmyagent:migration:ack");
    },
  },
  updater: {
    getChannel() {
      return ipcRenderer.invoke("onmyagent:updater:getChannel");
    },
    setChannel(channel) {
      return ipcRenderer.invoke("onmyagent:updater:setChannel", channel);
    },
    check(channel) {
      return ipcRenderer.invoke("onmyagent:updater:check", channel);
    },
    download() {
      return ipcRenderer.invoke("onmyagent:updater:download");
    },
    installAndRestart() {
      return ipcRenderer.invoke("onmyagent:updater:installAndRestart");
    },
    /** Subscribe to incremental download progress from electron-updater. */
    onDownloadProgress(callback) {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("onmyagent:updater:download-progress", handler);
      return () => {
        ipcRenderer.removeListener("onmyagent:updater:download-progress", handler);
      };
    },
  },
  browser: {
    show(bounds) { return ipcRenderer.invoke("onmyagent:browser:show", bounds); },
    hide() { return ipcRenderer.invoke("onmyagent:browser:hide"); },
    navigate(url) { return ipcRenderer.invoke("onmyagent:browser:navigate", url); },
    back() { return ipcRenderer.invoke("onmyagent:browser:back"); },
    forward() { return ipcRenderer.invoke("onmyagent:browser:forward"); },
    reload() { return ipcRenderer.invoke("onmyagent:browser:reload"); },
    setBounds(bounds) { return ipcRenderer.invoke("onmyagent:browser:bounds", bounds); },
    getState() { return ipcRenderer.invoke("onmyagent:browser:state"); },
    createTab(url) { return ipcRenderer.invoke("onmyagent:browser:createTab", url); },
    closeTab(tabId) { return ipcRenderer.invoke("onmyagent:browser:closeTab", tabId); },
    closeAllTabs() { return ipcRenderer.invoke("onmyagent:browser:closeAllTabs"); },
    selectTab(tabId) { return ipcRenderer.invoke("onmyagent:browser:selectTab", tabId); },
    reorderTabs(tabIds) { return ipcRenderer.invoke("onmyagent:browser:reorderTabs", tabIds); },
    listTabs() { return ipcRenderer.invoke("onmyagent:browser:listTabs"); },
    showTabContextMenu(tabId, point) { return ipcRenderer.invoke("onmyagent:browser:tabContextMenu", tabId, point); },
    destroy() { return ipcRenderer.invoke("onmyagent:browser:destroy"); },
    onStateChange(callback) {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on("onmyagent:browser:state", handler);
      return () => ipcRenderer.removeListener("onmyagent:browser:state", handler);
    },
    onPanelOpened(callback) {
      const handler = () => callback();
      ipcRenderer.on("onmyagent:browser:panel-opened", handler);
      return () => ipcRenderer.removeListener("onmyagent:browser:panel-opened", handler);
    },
    onPanelClosed(callback) {
      const handler = () => callback();
      ipcRenderer.on("onmyagent:browser:panel-closed", handler);
      return () => ipcRenderer.removeListener("onmyagent:browser:panel-closed", handler);
    },
  },
  meta: {
    initialDeepLinks: [],
    platform: normalizePlatform(process.platform),
    version: process.versions.electron,
  },
});

ipcRenderer.on(NATIVE_DEEP_LINK_EVENT, (_event, urls) => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NATIVE_DEEP_LINK_EVENT, { detail: urls }));
});

ipcRenderer.on(NATIVE_MENU_OPEN_SETTINGS_EVENT, () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NATIVE_MENU_OPEN_SETTINGS_EVENT));
});

ipcRenderer.on(NATIVE_MENU_TOGGLE_SIDEBAR_EVENT, () => {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(NATIVE_MENU_TOGGLE_SIDEBAR_EVENT));
});

if (!applyShellDocumentMarkers() && typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", applyShellDocumentMarkers, { once: true });
}

if (!installMenuOverlayDismissListeners() && typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", installMenuOverlayDismissListeners, { once: true });
}
