function normalizeTab(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("tab is required");
  }
  if (typeof input.tabId !== "string" || !input.tabId.trim()) {
    throw new TypeError("tabId is required");
  }
  if (!["user", "agent", "claimed"].includes(input.owner)) {
    throw new TypeError("tab owner is invalid");
  }
  if (input.owner !== "user" && (typeof input.sessionId !== "string" || !input.sessionId)) {
    throw new TypeError("agent and claimed tabs require a sessionId");
  }
  return {
    tabId: input.tabId,
    owner: input.owner,
    sessionId: input.sessionId ?? null,
    temporary: input.temporary === true,
    deliverable: input.deliverable === true,
    handoff: input.handoff === true,
  };
}

export function createBrowserTabRegistry() {
  const tabs = new Map();

  const get = (tabId) => {
    const tab = tabs.get(tabId);
    if (!tab) throw new Error(`unknown browser tab: ${tabId}`);
    return tab;
  };

  const assertControllable = (tabId, sessionId) => {
    const tab = get(tabId);
    if (tab.owner === "user" || tab.sessionId !== sessionId) {
      throw new Error(`browser tab ${tabId} is not owned by session ${sessionId}`);
    }
    return { ...tab };
  };

  return {
    register(input) {
      const tab = normalizeTab(input);
      if (tabs.has(tab.tabId)) throw new Error(`browser tab already exists: ${tab.tabId}`);
      tabs.set(tab.tabId, tab);
      return { ...tab };
    },
    list() {
      return [...tabs.values()].map((tab) => ({ ...tab }));
    },
    get(tabId) {
      return { ...get(tabId) };
    },
    remove(tabId) {
      const tab = get(tabId);
      tabs.delete(tabId);
      return { ...tab };
    },
    listForSession(sessionId) {
      return [...tabs.values()]
        .filter((tab) => tab.sessionId === sessionId)
        .map((tab) => ({ ...tab }));
    },
    assertControllable,
    claim(tabId, sessionId) {
      const tab = get(tabId);
      if (tab.owner !== "user") throw new Error(`browser tab ${tabId} is already claimed`);
      tab.owner = "claimed";
      tab.sessionId = sessionId;
      return { ...tab };
    },
    finalize(sessionId, tabIds) {
      const closed = [];
      for (const tabId of tabIds) {
        assertControllable(tabId, sessionId);
        tabs.delete(tabId);
        closed.push(tabId);
      }
      return closed;
    },
    turnEnded(sessionId) {
      const closed = [];
      for (const tab of tabs.values()) {
        if (
          tab.sessionId === sessionId &&
          tab.owner === "agent" &&
          tab.temporary &&
          !tab.deliverable &&
          !tab.handoff
        ) {
          tabs.delete(tab.tabId);
          closed.push(tab.tabId);
        }
      }
      return closed;
    },
    sessionDeleted(sessionId) {
      const closed = [];
      for (const tab of tabs.values()) {
        if (tab.sessionId !== sessionId) continue;
        tabs.delete(tab.tabId);
        closed.push(tab.tabId);
      }
      return closed;
    },
  };
}
