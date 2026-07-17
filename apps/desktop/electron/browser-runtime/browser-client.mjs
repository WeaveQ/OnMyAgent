function createLocator(request, tabId, selector) {
  const act = (action, params = {}) => request("locatorAction", {
    tabId,
    selector,
    action,
    ...params,
  });
  return Object.freeze({
    click: (options = {}) => act("click", options),
    fill: (value) => act("fill", { value }),
    type: (value, options = {}) => act("type", { value, ...options }),
    press: (key) => act("press", { key }),
    hover: () => act("hover"),
    check: () => act("check"),
    uncheck: () => act("uncheck"),
    selectOption: (value) => act("selectOption", { value }),
    textContent: () => act("textContent"),
    count: () => act("count"),
    first: () => createLocator(request, tabId, { ...selector, nth: 0 }),
    nth: (index) => createLocator(request, tabId, { ...selector, nth: index }),
    locator: (css) => createLocator(request, tabId, { parent: selector, css }),
  });
}

function createTab(request, metadata) {
  const tabId = metadata.tabId;
  const coordinateAction = (action, params = {}) => request("coordinateAction", {
    tabId,
    action,
    ...params,
  });
  return Object.freeze({
    id: tabId,
    get url() { return metadata.url ?? ""; },
    get title() { return metadata.title ?? ""; },
    goto: (url, options = {}) => request("navigate", { tabId, url, ...options }),
    back: () => request("navigateHistory", { tabId, direction: "back" }),
    forward: () => request("navigateHistory", { tabId, direction: "forward" }),
    reload: () => request("reload", { tabId }),
    close: () => request("finalizeTabs", { tabIds: [tabId] }),
    screenshot: (options = {}) => request("screenshot", { tabId, ...options }),
    evaluate: (expression) => request("evaluateReadonly", { tabId, expression }),
    playwright: Object.freeze({
      locator: (css) => createLocator(request, tabId, { css }),
      getByRole: (role, options = {}) => createLocator(request, tabId, { role, ...options }),
      getByLabel: (label, options = {}) => createLocator(request, tabId, { label, ...options }),
      getByText: (text, options = {}) => createLocator(request, tabId, { text, ...options }),
      getByPlaceholder: (placeholder, options = {}) => createLocator(request, tabId, { placeholder, ...options }),
      getByTestId: (testId) => createLocator(request, tabId, { testId }),
    }),
    dom_cua: Object.freeze({
      observe: (options = {}) => request("domObserve", { tabId, ...options }),
      click: (ref) => request("domAction", { tabId, action: "click", ref }),
      type: (ref, value) => request("domAction", { tabId, action: "type", ref, value }),
      scroll: (ref, deltaY) => request("domAction", { tabId, action: "scroll", ref, deltaY }),
    }),
    cua: Object.freeze({
      click: (point) => coordinateAction("click", point),
      doubleClick: (point) => coordinateAction("doubleClick", point),
      drag: (input) => coordinateAction("drag", input),
      scroll: (input) => coordinateAction("scroll", input),
      type: (text) => coordinateAction("type", { text }),
      keypress: (key) => coordinateAction("keypress", { key }),
      move: (point) => coordinateAction("move", point),
    }),
    dialog: Object.freeze({
      accept: (promptText) => request("dialogAction", { tabId, action: "accept", promptText }),
      dismiss: () => request("dialogAction", { tabId, action: "dismiss" }),
    }),
    clipboard: Object.freeze({
      read: () => request("clipboardRead", { tabId }),
      write: (text) => request("clipboardWrite", { tabId, text }),
    }),
    dev: Object.freeze({
      logs: (options = {}) => request("consoleLogs", { tabId, ...options }),
    }),
  });
}

function createBrowser(request, info) {
  const listTabs = async () => {
    const result = await request("listTabs", {});
    return (result.tabs ?? []).map((tab) => createTab(request, tab));
  };
  return Object.freeze({
    name: info.backend ?? "in-app",
    capabilities: Object.freeze([...(info.capabilities ?? [])]),
    tabs: Object.freeze({
      new: async (options = {}) => {
        const result = await request("createTab", options);
        return createTab(request, result.tab);
      },
      list: listTabs,
      get: async (tabId) => {
        const tabs = await listTabs();
        return tabs.find((tab) => tab.id === tabId) ?? null;
      },
      selected: async () => {
        const result = await request("selectedTab", {});
        return result.tab ? createTab(request, result.tab) : null;
      },
      finalize: (tabs) => request("finalizeTabs", {
        tabIds: tabs.map((tab) => typeof tab === "string" ? tab : tab.id),
      }),
      content: (tabId, options = {}) => request("tabContent", { tabId, ...options }),
    }),
    user: Object.freeze({
      openTabs: () => request("listUserTabs", {}),
      claimTab: async (tabId) => {
        const result = await request("claimTab", { tabId });
        return createTab(request, result.tab);
      },
      history: (options = {}) => request("history", options),
    }),
    documentation: (topic) => request("documentation", { topic }),
    nameSession: (name) => request("nameSession", { name }),
  });
}

export function setupBrowserRuntime(options) {
  if (typeof options?.request !== "function") throw new TypeError("browser request transport is required");
  if (!options.context || typeof options.context !== "object") throw new TypeError("browser execution context is required");
  const request = (method, params) => options.request(method, params, options.context);
  const getDefault = async () => createBrowser(request, await request("getInfo", {}));

  return Object.freeze({
    browsers: Object.freeze({
      list: async () => [await getDefault()],
      get: async (name) => {
        const browser = await getDefault();
        return browser.name === name ? browser : null;
      },
      getDefault,
      getForUrl: async () => getDefault(),
    }),
    documentation: (topic) => request("documentation", { topic }),
  });
}
