const BLOCKED_RAW_CDP_METHODS = new Set([
  "Page.navigate",
  "Browser.setDownloadBehavior",
  "Page.setDownloadBehavior",
  "DOM.setFileInputFiles",
]);

export function createChromeBackend(options) {
  const chrome = options?.chrome;
  if (!chrome?.tabs || !chrome?.debugger || !chrome?.storage?.session) {
    throw new TypeError("Chrome extension APIs are required");
  }
  const claims = new Map();
  const attached = new Set();

  const persist = () => chrome.storage.session.set({
    claimedTabs: [...claims.entries()].map(([tabId, sessionId]) => ({ tabId, sessionId })),
  });
  const assertClaimed = (sessionId, tabId) => {
    if (claims.get(tabId) !== sessionId) {
      throw new Error(`Chrome tab ${tabId} is not claimed by session ${sessionId}`);
    }
  };
  const attach = async (tabId) => {
    if (attached.has(tabId)) return;
    await chrome.debugger.attach({ tabId }, "1.3");
    attached.add(tabId);
  };

  return {
    async restore() {
      const stored = await chrome.storage.session.get("claimedTabs");
      const entries = Array.isArray(stored.claimedTabs) ? stored.claimedTabs : [];
      for (const entry of entries) {
        if (!Number.isInteger(entry?.tabId) || typeof entry?.sessionId !== "string") continue;
        claims.set(entry.tabId, entry.sessionId);
        await attach(entry.tabId);
      }
    },
    async claimTab(sessionId, tabId) {
      if (!Number.isInteger(tabId)) throw new TypeError("Chrome tab id is required");
      const owner = claims.get(tabId);
      if (owner && owner !== sessionId) throw new Error(`Chrome tab ${tabId} belongs to another session`);
      claims.set(tabId, sessionId);
      await attach(tabId);
      await persist();
      return { tabId, sessionId, owner: "claimed" };
    },
    async executeCdp(sessionId, tabId, method, params) {
      assertClaimed(sessionId, tabId);
      if (BLOCKED_RAW_CDP_METHODS.has(method)) {
        throw new Error(`${method} is blocked by browser host policy`);
      }
      await attach(tabId);
      return chrome.debugger.sendCommand({ tabId }, method, params ?? {});
    },
    async finalizeTabs(sessionId, tabIds) {
      const finalized = [];
      for (const tabId of tabIds) {
        assertClaimed(sessionId, tabId);
        if (attached.has(tabId)) {
          await chrome.debugger.detach({ tabId });
          attached.delete(tabId);
        }
        claims.delete(tabId);
        finalized.push(tabId);
      }
      await persist();
      return finalized;
    },
    async listUserTabs() {
      const tabs = await chrome.tabs.query({});
      return tabs.map((tab) => ({
        tabId: tab.id,
        title: tab.title ?? "",
        url: tab.url ?? "",
        claimed: claims.has(tab.id),
      }));
    },
    async history(optionsInput = {}) {
      return chrome.history.search({
        text: typeof optionsInput.text === "string" ? optionsInput.text : "",
        maxResults: Number.isInteger(optionsInput.maxResults) ? optionsInput.maxResults : 100,
        startTime: Number.isFinite(optionsInput.startTime) ? optionsInput.startTime : 0,
      });
    },
  };
}
