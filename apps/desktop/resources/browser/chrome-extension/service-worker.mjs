import { createChromeBackend } from "./chrome-backend.mjs";

const NATIVE_HOST = "com.onmyagent.browser";
const backend = createChromeBackend({ chrome });
let nativePort = null;

async function handleRequest(request) {
  const sessionId = request.context?.sessionId;
  if (typeof sessionId !== "string" || !sessionId) throw new Error("session context is required");
  if (request.method === "getInfo") return { backend: "chrome", capabilities: ["tabs", "cdp", "history", "downloads"] };
  if (request.method === "listUserTabs") return { tabs: await backend.listUserTabs() };
  if (request.method === "history") return { entries: await backend.history(request.params) };
  if (request.method === "claimTab") return { tab: await backend.claimTab(sessionId, request.params.tabId) };
  if (request.method === "executeCdp") {
    return { result: await backend.executeCdp(sessionId, request.params.tabId, request.params.method, request.params.params) };
  }
  if (request.method === "finalizeTabs") return { closedTabIds: await backend.finalizeTabs(sessionId, request.params.tabIds) };
  throw new Error(`unsupported Chrome browser method: ${request.method}`);
}

function connectNative() {
  nativePort = chrome.runtime.connectNative(NATIVE_HOST);
  nativePort.onMessage.addListener((request) => {
    void handleRequest(request)
      .then((result) => nativePort?.postMessage({ jsonrpc: "2.0", id: request.id, result }))
      .catch((error) => nativePort?.postMessage({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32603, message: error.message },
      }));
  });
  nativePort.onDisconnect.addListener(() => {
    nativePort = null;
  });
}

chrome.runtime.onInstalled.addListener(() => {
  void backend.restore().finally(connectNative);
});
chrome.runtime.onStartup.addListener(() => {
  void backend.restore().finally(connectNative);
});
void backend.restore().finally(connectNative);
