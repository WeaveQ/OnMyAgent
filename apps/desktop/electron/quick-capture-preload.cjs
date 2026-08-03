/**
 * Narrow preload for the quick-capture panel only.
 * Exposes window.quickCapture API — not the full desktop bridge.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("quickCapture", {
  getContext: () => ipcRenderer.invoke("quick-capture:get-context"),
  submit: (payload) => ipcRenderer.invoke("quick-capture:submit", payload),
  close: () => ipcRenderer.invoke("quick-capture:close"),
  onContext: (callback) => {
    const handler = (_event, data) => {
      try {
        callback(data);
      } catch {
        // ignore
      }
    };
    ipcRenderer.on("onmyagent:quick-capture:context", handler);
    return () => ipcRenderer.removeListener("onmyagent:quick-capture:context", handler);
  },
  onFocus: (callback) => {
    const handler = () => {
      try {
        callback();
      } catch {
        // ignore
      }
    };
    ipcRenderer.on("onmyagent:quick-capture:focus", handler);
    return () => ipcRenderer.removeListener("onmyagent:quick-capture:focus", handler);
  },
});
