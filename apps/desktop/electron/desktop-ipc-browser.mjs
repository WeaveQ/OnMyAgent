/**
 * Session browser IPC handlers for Electron main process.
 * Extracted from main.mjs (mechanical split; main remains composition root).
 */

/**
 * Register onmyagent:browser:* IPC handlers.
 * @param { ipcMain: import("electron").IpcMain, browserController: object } options
 */
export function registerDesktopBrowserIpc({ ipcMain, browserController }) {
ipcMain.handle("onmyagent:browser:show", (_event, bounds) =>
  browserController.attachBrowserView(bounds),
);
ipcMain.handle("onmyagent:browser:hide", () =>
  browserController.hideBrowserView(),
);
ipcMain.handle("onmyagent:browser:navigate", (_event, url, options) =>
  browserController.navigate(url, options),
);
ipcMain.handle("onmyagent:browser:back", () => browserController.goBack());
ipcMain.handle("onmyagent:browser:forward", () =>
  browserController.goForward(),
);
ipcMain.handle("onmyagent:browser:reload", () =>
  browserController.reload(),
);
ipcMain.handle("onmyagent:browser:bounds", (_event, bounds) =>
  browserController.setBounds(bounds),
);
ipcMain.handle("onmyagent:browser:state", () =>
  browserController.browserStatePayload(),
);
ipcMain.handle("onmyagent:browser:diagnostics", () =>
  browserController.diagnostics(),
);
ipcMain.handle("onmyagent:browser:createTab", (_event, url, options) => {
  const sessionId =
    options && typeof options === "object" && typeof options.sessionId === "string"
      ? options.sessionId
      : null;
  const tab = browserController.createBrowserTab(url ?? "about:blank", {
    select: true,
    sessionId,
  });
  return { tabId: tab.tabId, sessionId: tab.sessionId ?? sessionId };
});
ipcMain.handle("onmyagent:browser:closeTab", (_event, tabId) =>
  browserController.closeBrowserTab(tabId == null ? undefined : String(tabId)),
);
ipcMain.handle("onmyagent:browser:closeAllTabs", () =>
  browserController.closeAllBrowserTabs(),
);
ipcMain.handle("onmyagent:browser:selectTab", (_event, tabId) =>
  browserController.selectBrowserTab(String(tabId ?? "")).tabId,
);
ipcMain.handle("onmyagent:browser:reorderTabs", (_event, tabIds) =>
  browserController.reorderBrowserTabs(tabIds),
);
ipcMain.handle("onmyagent:browser:listTabs", () =>
  browserController.listBrowserTabs(),
);
ipcMain.handle("onmyagent:browser:tabContextMenu", (_event, tabId, point) =>
  browserController.showBrowserTabContextMenu(tabId, point),
);
ipcMain.handle("onmyagent:browser:destroy", () =>
  browserController.destroyBrowserView(),
);

}
