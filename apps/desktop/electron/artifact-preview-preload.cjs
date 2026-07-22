"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("__ONMYAGENT_ARTIFACT_VIEWER__", {
  onFile(callback) {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("onmyagent:artifact-preview:file", handler);
    ipcRenderer.send("onmyagent:artifact-preview:ready");
    return () => ipcRenderer.removeListener("onmyagent:artifact-preview:file", handler);
  },
});
