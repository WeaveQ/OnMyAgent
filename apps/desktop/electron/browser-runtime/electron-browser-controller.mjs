import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isBrowserAutomationSkillEnabled } from "../artifact-plugin-runtime.mjs";
import { createBrowserCapabilityAuthority } from "./browser-capability-authority.mjs";
import { createBrowserRpcServer, resolveBrowserRpcEndpoint } from "./browser-rpc-server.mjs";
import { createBrowserRuntime } from "./index.mjs";

function defaultBundledPluginsRoot(dirname) {
  const candidates = [
    typeof process.resourcesPath === "string"
      ? path.resolve(process.resourcesPath, "bundled-plugins")
      : null,
    path.resolve(dirname, "..", "resources", "bundled-plugins"),
    path.resolve(dirname, "..", "..", "resources", "bundled-plugins"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0] ?? null;
}

const DEFAULT_URL = "https://www.google.com";

function normalizeUrl(input, fallback = DEFAULT_URL) {
  const value = typeof input === "string" && input.trim() ? input.trim() : fallback;
  if (value === "about:blank") return value;
  return /^(?:https?|file):\/\//i.test(value) ? value : `https://${value}`;
}

function canNavigate(webContents, direction) {
  const history = webContents?.navigationHistory;
  if (direction === "back") return history?.canGoBack?.() ?? webContents?.canGoBack?.() ?? false;
  return history?.canGoForward?.() ?? webContents?.canGoForward?.() ?? false;
}

export function createElectronBrowserController(options) {
  if (typeof options?.WebContentsView !== "function") {
    throw new TypeError("WebContentsView is required");
  }
  const records = new Map();
  let order = [];
  let mainWindow = null;
  let activeTabId = null;
  let visible = false;
  let bounds = null;
  let rpcServer = null;
  let rpcEnvironment = null;

  const sendState = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send("onmyagent:browser:state", browserStatePayload());
  };

  /**
   * Mirror renderer openTarget(): expand the browser rail so EmbeddedBrowserViewport
   * can mount and call show(bounds). Creating a WebContentsView alone is not enough.
   */
  const requestOpenBrowserPanel = (detail = {}) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      return;
    }
    try {
      if (typeof mainWindow.isMinimized === "function" && mainWindow.isMinimized()) {
        mainWindow.restore?.();
      }
      mainWindow.focus?.();
    } catch {
      // Best-effort focus only.
    }
    // Send both a dedicated open event and a state snapshot so the renderer can
    // open even if one channel is missed.
    mainWindow.webContents.send("onmyagent:browser:panel-opened", detail);
    mainWindow.webContents.send("onmyagent:browser:state", browserStatePayload());
  };

  const createView = () => {
    const view = new options.WebContentsView({
      webPreferences: {
        backgroundThrottling: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: "persist:onmyagent-browser",
      },
    });
    view.webContents.setWindowOpenHandler?.(({ url }) => {
      void openAllowedExternalUrl(url);
      return { action: "deny" };
    });
    for (const eventName of [
      "did-navigate",
      "did-navigate-in-page",
      "page-title-updated",
      "did-start-loading",
      "did-stop-loading",
    ]) {
      view.webContents.on?.(eventName, sendState);
    }
    return view;
  };

  const isWindowAlive = (window) => {
    if (!window) return false;
    try {
      // Electron throws "Object has been destroyed" if we touch a dead window.
      if (typeof window.isDestroyed === "function" && window.isDestroyed()) {
        return false;
      }
      return Boolean(window.contentView);
    } catch {
      return false;
    }
  };

  const detach = (view) => {
    if (!view || !isWindowAlive(mainWindow)) return;
    try {
      const contentView = mainWindow.contentView;
      const children = contentView?.children;
      if (Array.isArray(children) && children.includes(view)) {
        contentView.removeChildView(view);
      }
    } catch {
      // Window or view already torn down during close — ignore.
    }
  };

  const attachSelected = () => {
    if (!mainWindow || !visible) return;
    const selected = records.get(activeTabId)?.view;
    for (const record of records.values()) {
      if (record.view !== selected) detach(record.view);
    }
    if (!selected) return;
    if (!mainWindow.contentView.children.includes(selected)) {
      mainWindow.contentView.addChildView(selected);
    }
    if (bounds && bounds.width > 0 && bounds.height > 0) selected.setBounds(bounds);
  };

  const pluginRoot =
    options.bundledPluginsRoot ??
    defaultBundledPluginsRoot(
      options.dirname ?? path.dirname(fileURLToPath(import.meta.url)),
    );
  const docsRoot = options.docsRoot
    ?? (pluginRoot ? path.join(pluginRoot, "browser", "docs") : null);
  const runtime = createBrowserRuntime({
    createView,
    requestApproval: options.requestApproval,
    clipboard: options.clipboard,
    getSelectedTabId: () => activeTabId,
    history: options.history,
    nameSession: options.nameSession,
    consoleLogs: options.consoleLogs,
    docsRoot,
    isBrowserEnabled:
      options.isBrowserEnabled ??
      (async () => {
        if (!pluginRoot) return true;
        return isBrowserAutomationSkillEnabled({
          pluginRoot,
          enablementPath: options.artifactPluginEnablementPath,
        });
      }),
  });

  // The host owns security and lifecycle; this controller owns Electron layout.
  const host = runtime.host;
  const originalRegisterUserTab = host.registerUserTab.bind(host);
  const originalHostDispatch = host.dispatch.bind(host);

  /**
   * Agent tools call host.dispatch via node-kernel browserRequest
   * (tabs.new → createTab), NOT runtime.dispatch (which only sees nodeReplWrite).
   * Layout/UI side effects must hook host.dispatch or they never run — that is
   * why localhost openTarget worked (renderer setCurrentSidePanel) while agent
   * createTab did not open the rail.
   */
  const syncControllerAfterHostMethod = (method, params, result) => {
    let openedAgentSurface = false;
    if (method === "createTab") {
      const tabId = result?.tab?.tabId;
      if (tabId) {
        if (!records.has(tabId)) {
          const view = host.getView?.(tabId);
          if (!view) throw new Error(`missing WebContentsView for browser tab ${tabId}`);
          records.set(tabId, { tab: result.tab, view });
          if (!order.includes(tabId)) order.push(tabId);
        }
        activeTabId = tabId;
        openedAgentSurface = true;
      }
    } else if (method === "navigate" || method === "claimTab") {
      const tabId = result?.tab?.tabId
        ?? (typeof params?.tabId === "string" ? params.tabId : null);
      if (tabId && records.has(tabId)) {
        activeTabId = tabId;
        openedAgentSurface = true;
      }
    }

    for (const tabId of [...order]) {
      if (!host.listAllTabs().some((tab) => tab.tabId === tabId)) {
        detach(records.get(tabId)?.view);
        records.delete(tabId);
        order = order.filter((id) => id !== tabId);
        if (activeTabId === tabId) activeTabId = order[0] ?? null;
      }
    }

    // Also pick up agent tabs created earlier that missed registration.
    for (const tab of host.listAllTabs()) {
      if (records.has(tab.tabId)) continue;
      const view = host.getView?.(tab.tabId);
      if (!view) continue;
      records.set(tab.tabId, { tab, view });
      if (!order.includes(tab.tabId)) order.push(tab.tabId);
      if (tab.owner === "agent" || tab.owner === "claimed") {
        activeTabId = tab.tabId;
        openedAgentSurface = true;
      }
    }

    if (openedAgentSurface) requestOpenBrowserPanel();
    attachSelected();
    sendState();
  };

  host.dispatch = async (method, params, context) => {
    const result = await originalHostDispatch(method, params, context);
    syncControllerAfterHostMethod(method, params, result);
    return result;
  };

  function listBrowserTabs() {
    return order.flatMap((tabId) => {
      const record = records.get(tabId);
      if (!record || record.view.webContents.isDestroyed()) return [];
      const described = host.describeTab(tabId);
      return [{
        ...described,
        favicon: record.favicon ?? null,
        canGoBack: canNavigate(record.view.webContents, "back"),
        canGoForward: canNavigate(record.view.webContents, "forward"),
        isLoading: record.view.webContents.isLoading(),
        isActive: tabId === activeTabId,
      }];
    });
  }

  function browserStatePayload() {
    const active = listBrowserTabs().find((tab) => tab.isActive);
    return {
      url: active?.url ?? "",
      title: active?.title ?? "",
      canGoBack: active?.canGoBack ?? false,
      canGoForward: active?.canGoForward ?? false,
      isLoading: active?.isLoading ?? false,
      activeTabId,
      tabs: listBrowserTabs(),
    };
  }

  function createBrowserTab(url = "about:blank", { select = true, sessionId = null } = {}) {
    const tabId = `tab-${randomUUID()}`;
    const view = createView();
    const tab = originalRegisterUserTab(tabId, view, {
      sessionId: typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : null,
    });
    records.set(tabId, { tab, view, favicon: null });
    order.push(tabId);
    void view.webContents.loadURL(normalizeUrl(url, "about:blank"));
    if (select || !activeTabId) activeTabId = tabId;
    attachSelected();
    sendState();
    return { ...tab, view };
  }

  function selectBrowserTab(tabId) {
    if (!records.has(tabId)) throw new Error(`Unknown browser tab: ${tabId}`);
    activeTabId = tabId;
    attachSelected();
    sendState();
    return host.describeTab(tabId);
  }

  function closeBrowserTab(tabId = activeTabId) {
    if (!tabId) return null;
    const record = records.get(tabId);
    if (!record) return null;
    if (host.describeTab(tabId).owner !== "user") {
      throw new Error("Agent tabs must be finalized by their owning session");
    }
    detach(record.view);
    host.closeUserTab(tabId);
    records.delete(tabId);
    order = order.filter((id) => id !== tabId);
    if (activeTabId === tabId) activeTabId = order[0] ?? null;
    attachSelected();
    sendState();
    return tabId;
  }

  function openAllowedExternalUrl(url) {
    if (typeof url !== "string") return Promise.resolve(false);
    try {
      const parsed = new URL(url.trim());
      if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) return Promise.resolve(false);
    } catch {
      return Promise.resolve(false);
    }
    return Promise.resolve(options.openExternal(url.trim())).then(() => true);
  }

  return {
    runtime,
    setMainWindow(window) { mainWindow = window; attachSelected(); },
    hasActiveBrowserTab: () => activeTabId !== null,
    createBrowserTab,
    listBrowserTabs,
    browserStatePayload,
    selectBrowserTab,
    closeBrowserTab,
    closeAllBrowserTabs() {
      const userTabIds = order.filter((tabId) => records.get(tabId)?.tab.owner === "user");
      for (const tabId of userTabIds) closeBrowserTab(tabId);
      return userTabIds;
    },
    reorderBrowserTabs(tabIds) {
      const next = Array.isArray(tabIds) ? tabIds.map(String) : [];
      if (next.length !== order.length || new Set(next).size !== order.length || next.some((id) => !records.has(id))) {
        throw new Error("Tab order must include every open tab exactly once.");
      }
      order = next;
      sendState();
      return listBrowserTabs();
    },
    attachBrowserView(nextBounds) { bounds = nextBounds; visible = true; attachSelected(); },
    hideBrowserView() { visible = false; for (const record of records.values()) detach(record.view); },
    setBounds(nextBounds) { bounds = nextBounds; attachSelected(); },
    navigate(url, _options = {}) {
      const record = records.get(activeTabId);
      if (!record || record.tab.owner !== "user") throw new Error("Select a user-owned tab to navigate directly");
      return record.view.webContents.loadURL(normalizeUrl(url));
    },
    goBack() { records.get(activeTabId)?.view.webContents.navigationHistory?.goBack?.(); },
    goForward() { records.get(activeTabId)?.view.webContents.navigationHistory?.goForward?.(); },
    reload() { records.get(activeTabId)?.view.webContents.reload(); },
    openAllowedExternalUrl,
    showBrowserTabContextMenu(_tabId, _point) { return false; },
    destroyBrowserView() {
      // Safe during BrowserWindow "closed": detach no-ops if the window is gone.
      for (const record of records.values()) detach(record.view);
      records.clear();
      order = [];
      activeTabId = null;
      visible = false;
      bounds = null;
    },
    async startRpc({ runtimeDir, instanceId = randomUUID() }) {
      if (rpcServer) return { ...rpcEnvironment };
      const bootstrap = randomBytes(32).toString("base64url");
      const authority = createBrowserCapabilityAuthority();
      const endpoint = resolveBrowserRpcEndpoint({ platform: process.platform, runtimeDir, instanceId });
      rpcServer = createBrowserRpcServer({
        authority,
        dispatch: (method, params, context) => runtime.dispatch(method, params, context),
        resolvePeer(_socket, request) {
          const peerPid = request?.method === "getCapability" ? request.params?.peerPid : null;
          if (!Number.isSafeInteger(peerPid) || peerPid <= 0) {
            throw new Error("browser peer PID is invalid");
          }
          return {
            peerPid,
            peerIdentity: process.platform === "win32"
              ? `sid:${process.env.USERNAME ?? "unknown"}`
              : `uid:${process.getuid?.() ?? 0}`,
          };
        },
        authorizeBootstrap(value) {
          if (typeof value !== "string") return false;
          const actual = Buffer.from(value);
          const expected = Buffer.from(bootstrap);
          return actual.length === expected.length && timingSafeEqual(actual, expected);
        },
      });
      await rpcServer.listen(endpoint);
      rpcEnvironment = Object.freeze({
        ONMYAGENT_BROWSER_RPC_ENDPOINT: endpoint,
        ONMYAGENT_BROWSER_RPC_BOOTSTRAP: bootstrap,
      });
      return { ...rpcEnvironment };
    },
    browserEnvironment() { return rpcEnvironment ? { ...rpcEnvironment } : {}; },
    diagnostics() {
      return {
        protocolVersion: 1,
        inAppBrowser: true,
        rpcListening: rpcServer !== null,
        backend: "in-app",
        platform: process.platform === "win32" ? "windows" : process.platform,
        openTabs: order.length,
        agentTabs: order.filter((tabId) => host.describeTab(tabId).owner !== "user").length,
      };
    },
    async close() {
      if (rpcServer) await rpcServer.close();
      rpcServer = null;
      rpcEnvironment = null;
      await runtime.close();
      records.clear();
      order = [];
      activeTabId = null;
    },
  };
}
