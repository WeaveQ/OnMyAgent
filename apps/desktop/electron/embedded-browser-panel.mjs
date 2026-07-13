import path from "node:path";
import browserTabMarkerContract from "./browser-tab-marker.cjs";

const {
  browserTabAdditionalArguments,
  normalizeBrowserTabOwner,
} = browserTabMarkerContract;

export function createEmbeddedBrowserPanel({ app, WebContentsView, clipboard, shell, dirname }) {
  let mainWindow = null;

  const browserTabs = new Map();
  let browserTabOrder = [];
  let activeBrowserTabId = null;
  let browserViewVisible = false;
  let lastBrowserBounds = null;
  let browserTabCounter = 0;
  let suppressNextPanelOpen = false;
  const BROWSER_DEFAULT_URL = "https://www.google.com";
  const MENU_OVERLAY_HTML = "overlay.html";
  const MENU_OVERLAY_WIDTH = 196;
  const MENU_OVERLAY_HEIGHT = 176;
  const MENU_OVERLAY_READY_TIMEOUT_MS = 2000;
  let menuOverlayView = null;
  let menuOverlayRequest = null;
  let menuOverlayReady = false;
  let menuOverlayReadyResolvers = [];
  let menuOverlayShowSerial = 0;

  function resetMenuOverlayReady({ resolvePending = false } = {}) {
    menuOverlayReady = false;
    if (resolvePending) {
      const resolvers = menuOverlayReadyResolvers.splice(0);
      for (const resolve of resolvers) resolve(false);
    }
  }

  function markMenuOverlayReady(view) {
    if (!view || view.webContents.isDestroyed()) return;
    menuOverlayReady = true;
    const resolvers = menuOverlayReadyResolvers.splice(0);
    for (const resolve of resolvers) resolve(true);
  }

  function waitForMenuOverlayReady(view) {
    if (menuOverlayReady) return Promise.resolve(true);
    return new Promise((resolve) => {
      let timer = null;
      const done = (ready) => {
        if (timer) clearTimeout(timer);
        menuOverlayReadyResolvers = menuOverlayReadyResolvers.filter(
          (candidate) => candidate !== done,
        );
        resolve(ready);
      };
      timer = setTimeout(() => done(false), MENU_OVERLAY_READY_TIMEOUT_MS);
      menuOverlayReadyResolvers.push(done);
      if (!view || view.webContents.isDestroyed()) done(false);
    });
  }

  /** Send an IPC message to the main renderer, guarding against disposed frames. */
  function sendToRenderer(channel, payload) {
    if (
      !mainWindow ||
      mainWindow.isDestroyed() ||
      mainWindow.webContents.isDestroyed()
    )
      return;
    try {
      mainWindow.webContents.send(channel, payload);
    } catch {
      /* window closing */
    }
  }

  function createBrowserTabId() {
    browserTabCounter += 1;
    return `tab_${Date.now().toString(36)}_${browserTabCounter.toString(36)}`;
  }

  function normalizeBrowserUrl(url, fallback = BROWSER_DEFAULT_URL) {
    const target = typeof url === "string" && url.trim() ? url.trim() : fallback;
    if (!target || target === "about:blank") return "about:blank";
    return /^(?:https?|file):\/\//i.test(target) ? target : `https://${target}`;
  }

  function isExternalOpenUrlAllowed(url) {
    if (typeof url !== "string") return false;
    const trimmed = url.trim();
    if (!trimmed) return false;
    try {
      const parsed = new URL(trimmed);
      return ["http:", "https:", "mailto:"].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  async function openAllowedExternalUrl(url) {
    if (!isExternalOpenUrlAllowed(url)) return false;
    await shell.openExternal(url.trim());
    return true;
  }

  function getBrowserTab(tabId = activeBrowserTabId) {
    return tabId ? (browserTabs.get(tabId) ?? null) : null;
  }

  function getActiveBrowserView() {
    return getBrowserTab()?.view ?? null;
  }

  function getActiveWebContents() {
    return getActiveBrowserView()?.webContents ?? null;
  }

  function webContentsCanGoBack(webContents) {
    return (
      webContents?.navigationHistory?.canGoBack?.() ??
      webContents?.canGoBack?.() ??
      false
    );
  }

  function webContentsCanGoForward(webContents) {
    return (
      webContents?.navigationHistory?.canGoForward?.() ??
      webContents?.canGoForward?.() ??
      false
    );
  }

  function listBrowserTabs(options = {}) {
    const filterByOwner = Object.hasOwn(options, "ownerId");
    const requestedOwnerId = filterByOwner
      ? normalizeBrowserTabOwner(options.ownerId)
      : null;
    return browserTabOrder
      .map((tabId) => {
        const tab = browserTabs.get(tabId);
        if (!tab || tab.view.webContents.isDestroyed()) return null;
        if (filterByOwner && tab.ownerId !== requestedOwnerId) return null;
        const { webContents } = tab.view;
        return {
          tabId,
          ownerId: tab.ownerId,
          url: webContents.getURL(),
          title: webContents.getTitle(),
          favicon: tab.favicon,
          canGoBack: webContentsCanGoBack(webContents),
          canGoForward: webContentsCanGoForward(webContents),
          isLoading: webContents.isLoading(),
          isActive: tabId === activeBrowserTabId,
        };
      })
      .filter(Boolean);
  }

  function browserStatePayload() {
    const activeTab = getBrowserTab();
    const activeWebContents = activeTab?.view.webContents;
    const activeState =
      activeWebContents && !activeWebContents.isDestroyed()
        ? {
            url: activeWebContents.getURL(),
            title: activeWebContents.getTitle(),
            canGoBack: webContentsCanGoBack(activeWebContents),
            canGoForward: webContentsCanGoForward(activeWebContents),
            isLoading: activeWebContents.isLoading(),
          }
        : {
            url: "",
            title: "",
            canGoBack: false,
            canGoForward: false,
            isLoading: false,
          };
    return {
      ...activeState,
      activeTabId: activeBrowserTabId,
      tabs: listBrowserTabs(),
    };
  }

  function browserTabUrl(tab) {
    const url = tab?.view?.webContents?.getURL?.();
    return typeof url === "string" && url && url !== "about:blank" ? url : null;
  }

  function isHttpUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  function normalizeMenuOverlayPoint(point) {
    if (!point || typeof point !== "object") {
      return { x: 0, y: 0 };
    }
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { x: 0, y: 0 };
    }
    return { x: Math.round(x), y: Math.round(y) };
  }

  function menuOverlayBounds(point) {
    const [contentWidth, contentHeight] = mainWindow?.getContentSize?.() ?? [
      MENU_OVERLAY_WIDTH,
      MENU_OVERLAY_HEIGHT,
    ];
    return {
      x: Math.min(
        Math.max(point.x, 0),
        Math.max(contentWidth - MENU_OVERLAY_WIDTH - 4, 0),
      ),
      y: Math.min(
        Math.max(point.y, 0),
        Math.max(contentHeight - MENU_OVERLAY_HEIGHT - 4, 0),
      ),
      width: MENU_OVERLAY_WIDTH,
      height: MENU_OVERLAY_HEIGHT,
    };
  }

  function menuOverlayUrl() {
    const currentUrl = mainWindow?.webContents?.getURL?.();
    if (currentUrl && /^https?:\/\//i.test(currentUrl)) {
      return new URL(MENU_OVERLAY_HTML, currentUrl).toString();
    }
    return null;
  }

  async function loadMenuOverlayRenderer(view) {
    const devUrl = menuOverlayUrl();
    if (devUrl) {
      await view.webContents.loadURL(devUrl);
      return;
    }

    const packagedOverlayPath = path.join(
      process.resourcesPath,
      "app-dist",
      MENU_OVERLAY_HTML,
    );
    const devOverlayPath = path.resolve(
      dirname,
      "../../app/dist",
      MENU_OVERLAY_HTML,
    );
    await view.webContents.loadFile(
      app.isPackaged ? packagedOverlayPath : devOverlayPath,
    );
  }

  async function ensureMenuOverlayView() {
    if (menuOverlayView && !menuOverlayView.webContents.isDestroyed()) {
      return menuOverlayView;
    }

    const view = new WebContentsView({
      webPreferences: {
        // Electron only runs ESM preload scripts reliably with sandbox disabled.
        // Keep the bridge isolated and node-free for the React overlay document.
        backgroundThrottling: false,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(dirname, "menu-overlay-preload.mjs"),
      },
    });
    view.setBackgroundColor?.("#00000000");
    view.setVisible?.(false);
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on(
      "did-start-navigation",
      (_event, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) resetMenuOverlayReady();
      },
    );
    view.webContents.once("destroyed", () => {
      if (menuOverlayView === view) {
        menuOverlayView = null;
        menuOverlayRequest = null;
        resetMenuOverlayReady({ resolvePending: true });
      }
    });

    menuOverlayView = view;
    resetMenuOverlayReady({ resolvePending: true });
    await loadMenuOverlayRenderer(view);
    return view;
  }

  function hideMenuOverlay() {
    const view = menuOverlayView;
    menuOverlayShowSerial += 1;
    menuOverlayRequest = null;
    if (!view || !mainWindow) return;
    view.setVisible?.(false);
    try {
      if (mainWindow.contentView.children.includes(view)) {
        mainWindow.contentView.removeChildView(view);
      }
    } catch {
      // already removed
    }
  }

  function bringMenuOverlayToTop(view) {
    if (!mainWindow) return;
    try {
      if (mainWindow.contentView.children.includes(view)) {
        mainWindow.contentView.removeChildView(view);
      }
    } catch {
      // already removed
    }
    mainWindow.contentView.addChildView(view);
  }

  function tabMenuRequest(tab, point) {
    const url = browserTabUrl(tab);
    return {
      id: `tab-menu:${tab.tabId}:${Date.now()}`,
      source: "tab",
      tabId: tab.tabId,
      url,
      bounds: menuOverlayBounds(normalizeMenuOverlayPoint(point)),
      items: [
        { id: "copy-url", label: "Copy URL", iconName: "copy", disabled: !url },
        {
          id: "open-external",
          label: "Open in Browser",
          iconName: "external",
          disabled: !(url && isHttpUrl(url)),
        },
        {
          id: "close-tab",
          label: "Close Tab",
          iconName: "close",
          separatorBefore: true,
        },
        { id: "close-all-tabs", label: "Close All Tabs", iconName: "close" },
      ],
    };
  }

  async function showBrowserTabContextMenu(tabId, point) {
    const tab = getBrowserTab(String(tabId ?? ""));
    if (!mainWindow || !tab || tab.view.webContents.isDestroyed()) return;

    const showSerial = menuOverlayShowSerial + 1;
    menuOverlayShowSerial = showSerial;
    const request = tabMenuRequest(tab, point);
    const view = await ensureMenuOverlayView();
    if (showSerial !== menuOverlayShowSerial || menuOverlayView !== view) return;
    menuOverlayRequest = request;
    view.setBounds(request.bounds);
    view.setVisible?.(true);
    bringMenuOverlayToTop(view);
    const ready = await waitForMenuOverlayReady(view);
    if (
      showSerial !== menuOverlayShowSerial ||
      menuOverlayRequest !== request ||
      menuOverlayView !== view
    )
      return;
    if (!ready) {
      console.warn(
        "[menu-overlay] renderer did not signal readiness before show",
      );
    }
    view.webContents.send("onmyagent:menu-overlay:show", {
      id: request.id,
      source: request.source,
      items: request.items,
    });
    view.webContents.focus();
  }

  function handleMenuOverlayChoice(payload) {
    if (!payload || payload.requestId !== menuOverlayRequest?.id) return;
    const request = menuOverlayRequest;
    const tab = getBrowserTab(request.tabId);
    hideMenuOverlay();

    switch (payload.itemId) {
      case "copy-url":
        if (request.url) clipboard.writeText(request.url);
        break;
      case "open-external":
        if (request.url && isHttpUrl(request.url))
          void openAllowedExternalUrl(request.url);
        break;
      case "close-tab":
        if (tab) closeBrowserTab(tab.tabId);
        break;
      case "close-all-tabs":
        closeAllBrowserTabs();
        break;
    }
  }

  function createBrowserTab(
    url = "about:blank",
    { select = true, ownerId = null } = {},
  ) {
    const tabId = createBrowserTabId();
    const normalizedOwnerId = normalizeBrowserTabOwner(ownerId);
    const view = new WebContentsView({
      webPreferences: {
        backgroundThrottling: false,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(dirname, "browser-content-preload.cjs"),
        partition: "persist:onmyagent-browser",
        additionalArguments: browserTabAdditionalArguments(tabId),
      },
    });
    const tab = { tabId, ownerId: normalizedOwnerId, view, favicon: null };
    browserTabs.set(tabId, tab);
    browserTabOrder.push(tabId);
    // Load about:blank immediately to preempt persistent-session restore.
    // Cookies live on the session object, not the document — they survive this.
    view.webContents.loadURL("about:blank");
    view.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
      void openAllowedExternalUrl(targetUrl);
      return { action: "deny" };
    });
    view.webContents.on(
      "did-start-navigation",
      (_event, targetUrl, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace && targetUrl !== "about:blank") {
          if (suppressNextPanelOpen) {
            suppressNextPanelOpen = false;
            return;
          }
          sendToRenderer("onmyagent:browser:panel-opened");
        }
      },
    );
    view.webContents.on("did-navigate", () => sendBrowserState());
    view.webContents.on("did-navigate-in-page", () => sendBrowserState());
    view.webContents.on("page-title-updated", () => sendBrowserState());
    view.webContents.on("page-favicon-updated", (_event, favicons) => {
      tab.favicon = Array.isArray(favicons) ? (favicons[0] ?? null) : null;
      sendBrowserState();
    });
    view.webContents.on("did-start-loading", () => sendBrowserState());
    view.webContents.on("did-stop-loading", () => sendBrowserState());
    view.webContents.once("destroyed", () => {
      browserTabs.delete(tabId);
      browserTabOrder = browserTabOrder.filter((id) => id !== tabId);
      if (activeBrowserTabId === tabId)
        activeBrowserTabId = browserTabOrder[0] ?? null;
      sendBrowserState();
    });
    if (select || !activeBrowserTabId) {
      selectBrowserTab(tabId);
    } else {
      sendBrowserState();
    }
    const finalUrl = normalizeBrowserUrl(url, "about:blank");
    if (finalUrl !== "about:blank") {
      view.webContents.loadURL(finalUrl);
    }
    return tab;
  }

  function detachBrowserView(view) {
    if (!mainWindow || !view) return;
    try {
      if (mainWindow.contentView.children.includes(view)) {
        mainWindow.contentView.removeChildView(view);
      }
    } catch {
      // already removed
    }
  }

  function attachActiveBrowserView() {
    if (!mainWindow || !browserViewVisible) return;
    const view = getActiveBrowserView();
    if (!view) return;
    for (const tab of browserTabs.values()) {
      if (tab.view !== view) detachBrowserView(tab.view);
    }
    if (!mainWindow.contentView.children.includes(view)) {
      mainWindow.contentView.addChildView(view);
    }
    if (
      lastBrowserBounds &&
      lastBrowserBounds.width > 0 &&
      lastBrowserBounds.height > 0
    ) {
      view.setBounds(lastBrowserBounds);
    }
  }

  function selectBrowserTab(tabId) {
    if (!browserTabs.has(tabId)) throw new Error(`Unknown browser tab: ${tabId}`);
    hideMenuOverlay();
    const previousView = getActiveBrowserView();
    activeBrowserTabId = tabId;
    if (previousView && previousView !== getActiveBrowserView()) {
      detachBrowserView(previousView);
    }
    attachActiveBrowserView();
    sendBrowserState();
    return getBrowserTab(tabId);
  }

  function closeBrowserTab(tabId = activeBrowserTabId) {
    const tab = getBrowserTab(tabId);
    if (!tab) return null;
    if (menuOverlayRequest?.tabId === tabId) hideMenuOverlay();
    const closingIndex = browserTabOrder.indexOf(tabId);
    const wasActive = activeBrowserTabId === tabId;
    detachBrowserView(tab.view);
    browserTabs.delete(tabId);
    browserTabOrder = browserTabOrder.filter((id) => id !== tabId);
    if (wasActive) {
      const nextTabId =
        browserTabOrder[Math.min(closingIndex, browserTabOrder.length - 1)] ??
        browserTabOrder[closingIndex - 1] ??
        null;
      activeBrowserTabId = nextTabId;
      if (nextTabId) {
        attachActiveBrowserView();
      } else {
        hideBrowserView();
        sendToRenderer("onmyagent:browser:panel-closed");
      }
    }
    try {
      tab.view.webContents.close();
    } catch {
      /* already destroyed */
    }
    sendBrowserState();
    return tabId;
  }

  function closeAllBrowserTabs() {
    const closedTabIds = [...browserTabOrder];
    if (closedTabIds.length === 0) return [];
    hideMenuOverlay();
    const tabsToClose = closedTabIds
      .map((tabId) => browserTabs.get(tabId))
      .filter(Boolean);
    hideBrowserView();
    browserTabs.clear();
    browserTabOrder = [];
    activeBrowserTabId = null;
    for (const tab of tabsToClose) {
      try {
        tab.view.webContents.close();
      } catch {
        /* already destroyed */
      }
    }
    sendToRenderer("onmyagent:browser:panel-closed");
    sendBrowserState();
    return closedTabIds;
  }

  function closeBrowserTabsByOwner(ownerId) {
    const normalizedOwnerId = normalizeBrowserTabOwner(ownerId);
    if (!normalizedOwnerId) return [];
    const ownedTabIds = browserTabOrder.filter(
      (tabId) => browserTabs.get(tabId)?.ownerId === normalizedOwnerId,
    );
    for (const tabId of ownedTabIds) closeBrowserTab(tabId);
    return ownedTabIds;
  }

  function reorderBrowserTabs(tabIds) {
    const nextOrder = Array.isArray(tabIds) ? tabIds.map(String) : [];
    if (nextOrder.length !== browserTabOrder.length) {
      throw new Error("Tab order must include every open tab.");
    }
    if (new Set(nextOrder).size !== nextOrder.length) {
      throw new Error("Tab order must not contain duplicate tabs.");
    }
    const current = new Set(browserTabOrder);
    if (nextOrder.some((tabId) => !current.has(tabId))) {
      throw new Error("Tab order contains an unknown tab.");
    }
    browserTabOrder = nextOrder;
    sendBrowserState();
    return listBrowserTabs();
  }

  function sendBrowserState() {
    sendToRenderer("onmyagent:browser:state", browserStatePayload());
  }

  /**
   * Attach the browser view to the main window.
   * @param {object} bounds — { x, y, width, height }
   * @param {object} [opts]
   * @param {boolean} [opts.preloadDefault=true] - load default URL if the view has no URL
   * @param {boolean} [opts.ensureTab=true] - create a blank tab if needed
   */
  function attachBrowserView(
    bounds,
    { preloadDefault = true, ensureTab = true } = {},
  ) {
    if (!mainWindow) return;
    lastBrowserBounds = bounds;
    browserViewVisible = true;
    if (ensureTab && !activeBrowserTabId) createBrowserTab("about:blank");
    const view = getActiveBrowserView();
    attachActiveBrowserView();
    if (bounds.width > 0 && bounds.height > 0) {
      view?.setBounds(bounds);
    }
    const url = view?.webContents.getURL();
    if (preloadDefault && (!url || url === "about:blank")) {
      view?.webContents.loadURL(BROWSER_DEFAULT_URL);
    }
    sendBrowserState();
  }

  function hideBrowserView() {
    hideMenuOverlay();
    browserViewVisible = false;
    if (!mainWindow) return;
    for (const tab of browserTabs.values()) {
      detachBrowserView(tab.view);
    }
  }

  function destroyBrowserView() {
    hideBrowserView();
    const overlayView = menuOverlayView;
    menuOverlayView = null;
    menuOverlayRequest = null;
    try {
      overlayView?.webContents.close();
    } catch {
      /* already destroyed */
    }
    for (const tab of browserTabs.values()) {
      try {
        tab.view.webContents.close();
      } catch {
        /* already destroyed */
      }
    }
    browserTabs.clear();
    browserTabOrder = [];
    activeBrowserTabId = null;
    lastBrowserBounds = null;
    sendBrowserState();
  }

  function setMainWindow(window) {
    mainWindow = window;
  }

  function hasActiveBrowserTab() {
    return Boolean(activeBrowserTabId);
  }

  function onMenuOverlayReady(event) {
    if (event.sender !== menuOverlayView?.webContents) return;
    markMenuOverlayReady(menuOverlayView);
  }

  function onMenuOverlayChoose(event, payload) {
    if (event.sender !== menuOverlayView?.webContents) return;
    handleMenuOverlayChoice(payload);
  }
  function onMenuOverlayClose(event, payload) {
    if (event.sender !== menuOverlayView?.webContents) return;
    if (payload?.requestId && payload.requestId !== menuOverlayRequest?.id) {
      return;
    }
    hideMenuOverlay();
  }

  function onMenuOverlayDismiss(event) {
    if (event.sender === menuOverlayView?.webContents) return;
    hideMenuOverlay();
  }

  function navigate(url, { announcePanelOpen = true } = {}) {
    const view =
      getActiveBrowserView() ??
      createBrowserTab("about:blank", { select: true }).view;
    suppressNextPanelOpen = !announcePanelOpen;
    view.webContents.loadURL(normalizeBrowserUrl(url));
  }
  function goBack() {
    const webContents = getActiveWebContents();
    if (webContentsCanGoBack(webContents)) webContents.goBack();
  }

  function goForward() {
    const webContents = getActiveWebContents();
    if (webContentsCanGoForward(webContents)) webContents.goForward();
  }

  function reload() {
    getActiveWebContents()?.reload();
  }

  function setBounds(bounds) {
    lastBrowserBounds = bounds;
    const view = getActiveBrowserView();
    if (view && browserViewVisible && bounds.width > 0 && bounds.height > 0) {
      view.setBounds(bounds);
    }
  }

  return {
    setMainWindow,
    hasActiveBrowserTab,
    openAllowedExternalUrl,
    createBrowserTab,
    destroyBrowserView,
    attachBrowserView,
    hideBrowserView,
    navigate,
    goBack,
    goForward,
    reload,
    setBounds,
    browserStatePayload,
    closeBrowserTab,
    closeAllBrowserTabs,
    closeBrowserTabsByOwner,
    selectBrowserTab,
    reorderBrowserTabs,
    listBrowserTabs,
    showBrowserTabContextMenu,
    onMenuOverlayReady,
    onMenuOverlayChoose,
    onMenuOverlayClose,
    onMenuOverlayDismiss,
  };
}
