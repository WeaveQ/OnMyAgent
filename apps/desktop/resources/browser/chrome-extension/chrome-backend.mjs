const BLOCKED_RAW_CDP_METHODS = new Set([
  "Page.navigate",
  "Browser.setDownloadBehavior",
  "Page.setDownloadBehavior",
  "DOM.setFileInputFiles",
]);

export function createChromeBackend(options) {
  const chrome = options?.chrome;
  const claims = new Map();
  const attached = new Set();
  const persist = () => chrome.storage.session.set({
    claimedTabs: [...claims.entries()].map(([tabId, sessionId]) => ({ tabId, sessionId })),
  });
  const assertClaimed = (sessionId, tabId) => {
    if (claims.get(tabId) !== sessionId) throw new Error(`Chrome tab ${tabId} is not claimed by this session`);
  };
  const attach = async (tabId) => {
    if (attached.has(tabId)) return;
    await chrome.debugger.attach({ tabId }, "1.3");
    attached.add(tabId);
  };

  return {
    async restore() {
      const stored = await chrome.storage.session.get("claimedTabs");
      for (const entry of Array.isArray(stored.claimedTabs) ? stored.claimedTabs : []) {
        if (!Number.isInteger(entry?.tabId) || typeof entry?.sessionId !== "string") continue;
        claims.set(entry.tabId, entry.sessionId);
        await attach(entry.tabId);
      }
    },
    async claimTab(sessionId, tabId) {
      const owner = claims.get(tabId);
      if (owner && owner !== sessionId) throw new Error("Chrome tab belongs to another session");
      claims.set(tabId, sessionId);
      await attach(tabId);
      await persist();
      return { tabId, sessionId, owner: "claimed" };
    },
    async executeCdp(sessionId, tabId, method, params) {
      assertClaimed(sessionId, tabId);
      if (BLOCKED_RAW_CDP_METHODS.has(method)) throw new Error(`${method} is blocked by browser host policy`);
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
      return (await chrome.tabs.query({})).map((tab) => ({
        tabId: tab.id,
        title: tab.title ?? "",
        url: tab.url ?? "",
        claimed: claims.has(tab.id),
      }));
    },
    history(optionsInput = {}) {
      return chrome.history.search({
        text: typeof optionsInput.text === "string" ? optionsInput.text : "",
        maxResults: Number.isInteger(optionsInput.maxResults) ? optionsInput.maxResults : 100,
        startTime: Number.isFinite(optionsInput.startTime) ? optionsInput.startTime : 0,
      });
    },
  };
}
