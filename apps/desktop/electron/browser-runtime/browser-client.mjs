const IN_APP_BROWSER_IDS = new Set(["in-app", "iab", "browser", "default"]);

function createCapabilityCollection(ids) {
  const list = async () =>
    ids.map((id) => ({
      id,
      description: id,
    }));
  return Object.freeze({
    list,
    get: async (id) => {
      if (!ids.includes(id)) return null;
      return Object.freeze({
        id,
        documentation: async () => `Capability: ${id}`,
      });
    },
  });
}

function createLocator(request, tabId, selector) {
  const act = async (action, params = {}) => {
    const result = await request("locatorAction", {
      tabId,
      selector,
      action,
      ...params,
    });
    if (result && typeof result === "object" && "value" in result) {
      return result.value;
    }
    return result;
  };
  const self = Object.freeze({
    click: (options = {}) => act("click", options),
    fill: (value, options = {}) => act("fill", { value, ...options }),
    type: (value, options = {}) => act("type", { value, ...options }),
    press: (key, options = {}) => act("press", { key, ...options }),
    hover: (options = {}) => act("hover", options),
    check: (options = {}) => act("check", options),
    uncheck: (options = {}) => act("uncheck", options),
    setChecked: (checked, options = {}) =>
      act(checked ? "check" : "uncheck", options),
    selectOption: (value, options = {}) => act("selectOption", { value, ...options }),
    textContent: (options = {}) => act("textContent", options),
    innerText: (options = {}) => act("innerText", options),
    getAttribute: (name, options = {}) => act("getAttribute", { name, ...options }),
    count: () => act("count"),
    isVisible: () => act("isVisible"),
    isEnabled: () => act("isEnabled"),
    evaluate: async (pageFunction, arg, options = {}) => {
      const result = await request("playwrightEvaluate", {
        tabId,
        pageFunction:
          typeof pageFunction === "function"
            ? pageFunction.toString()
            : String(pageFunction),
        arg,
        selector,
        ...options,
      });
      if (result && typeof result === "object" && "value" in result) {
        return result.value;
      }
      return result;
    },
    waitFor: async (options = {}) => {
      const deadline = Date.now() + Math.min(Number(options.timeoutMs) || 10_000, 60_000);
      while (Date.now() < deadline) {
        if (await act("waitFor", options)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("locator waitFor timed out");
    },
    all: async () => {
      const total = Number(await act("count")) || 0;
      return Array.from({ length: total }, (_, index) =>
        createLocator(request, tabId, { ...selector, nth: index }),
      );
    },
    first: () => createLocator(request, tabId, { ...selector, nth: 0 }),
    last: () => createLocator(request, tabId, { ...selector, nth: -1 }),
    nth: (index) => createLocator(request, tabId, { ...selector, nth: index }),
    locator: (css, options = {}) =>
      createLocator(request, tabId, { parent: selector, css, ...options }),
    getByRole: (role, options = {}) =>
      createLocator(request, tabId, { parent: selector, role, ...options }),
    getByLabel: (label, options = {}) =>
      createLocator(request, tabId, { parent: selector, label, ...options }),
    getByText: (text, options = {}) =>
      createLocator(request, tabId, { parent: selector, text, ...options }),
    getByPlaceholder: (placeholder, options = {}) =>
      createLocator(request, tabId, {
        parent: selector,
        placeholder,
        ...options,
      }),
    getByTestId: (testId) =>
      createLocator(request, tabId, { parent: selector, testId }),
  });
  return self;
}

function createFrameLocator(request, tabId, frameSelector) {
  return Object.freeze({
    locator: (css, options = {}) =>
      createLocator(request, tabId, { frameSelector, css, ...options }),
    getByRole: (role, options = {}) =>
      createLocator(request, tabId, { frameSelector, role, ...options }),
    getByLabel: (label, options = {}) =>
      createLocator(request, tabId, { frameSelector, label, ...options }),
    getByText: (text, options = {}) =>
      createLocator(request, tabId, { frameSelector, text, ...options }),
    getByPlaceholder: (placeholder, options = {}) =>
      createLocator(request, tabId, {
        frameSelector,
        placeholder,
        ...options,
      }),
    getByTestId: (testId) =>
      createLocator(request, tabId, { frameSelector, testId }),
    frameLocator: (nested) =>
      createFrameLocator(request, tabId, `${frameSelector} >> ${nested}`),
  });
}

function unwrapValue(result) {
  if (result && typeof result === "object" && "value" in result) {
    return result.value;
  }
  return result;
}

function createTab(request, metadata) {
  const tabId = metadata.tabId;
  const coordinateAction = (action, params = {}) =>
    request("coordinateAction", {
      tabId,
      action,
      ...params,
    });
  let meta = { ...metadata };

  const refreshMeta = async () => {
    const result = await request("describeTab", { tabId });
    if (result?.tab) meta = result.tab;
    return meta;
  };

  const url = async () => (await refreshMeta()).url ?? meta.url ?? "";
  const title = async () => (await refreshMeta()).title ?? meta.title ?? "";
  const goto = async (targetUrl, options = {}) => {
    const result = await request("navigate", { tabId, url: targetUrl, ...options });
    if (result?.tab) meta = result.tab;
    return result;
  };
  const back = () => request("navigateHistory", { tabId, direction: "back" });
  const forward = () => request("navigateHistory", { tabId, direction: "forward" });
  const reload = () => request("reload", { tabId });
  const close = () => request("finalizeTabs", { tabIds: [tabId] });
  const screenshot = async (options = {}) => {
    // Defaults keep tool output under typical transcript limits.
    const result = await request("screenshot", {
      tabId,
      format: options.format ?? "jpeg",
      maxWidth: options.maxWidth ?? 800,
      quality: options.quality ?? 45,
      ...options,
    });
    return result;
  };

  /**
   * Hybrid orientation (DOM + vision): one call for distilled interactive nodes
   * and a compressed screenshot with scale metadata for coordinate mapping.
   * Market pattern: DOM-primary, vision-assist (Browser Use / Stagehand-style).
   */
  const sense = async (options = {}) => {
    const maxNodesRaw = Number(options.maxNodes);
    const maxNodes =
      Number.isFinite(maxNodesRaw) && maxNodesRaw > 0
        ? Math.min(Math.floor(maxNodesRaw), 80)
        : 40;
    const [shot, observation, pageUrl, pageTitle] = await Promise.all([
      screenshot({
        maxWidth: options.maxWidth ?? 800,
        quality: options.quality ?? 45,
        format: options.format ?? "jpeg",
      }),
      request("domObserve", { tabId }),
      url(),
      title(),
    ]);
    const scaleX = Number(shot?.scaleX) || 1;
    const scaleY = Number(shot?.scaleY) || 1;
    const rawNodes = Array.isArray(observation?.nodes) ? observation.nodes : [];
    const ranked = [...rawNodes].sort((a, b) => {
      const la = String(a?.label ?? "").trim().length;
      const lb = String(b?.label ?? "").trim().length;
      return lb - la;
    });
    const nodes = ranked.slice(0, maxNodes).map((node) => {
      const bounds = node?.bounds && typeof node.bounds === "object" ? node.bounds : {};
      const pageX = Number(bounds.x) + Number(bounds.width || 0) / 2;
      const pageY = Number(bounds.y) + Number(bounds.height || 0) / 2;
      return {
        ref: node?.ref ?? null,
        role: node?.role ?? "",
        label: String(node?.label ?? "").trim().slice(0, 120),
        bounds: {
          x: Number(bounds.x) || 0,
          y: Number(bounds.y) || 0,
          width: Number(bounds.width) || 0,
          height: Number(bounds.height) || 0,
        },
        center: { x: pageX, y: pageY },
        // Image-space center for vision ↔ cua mapping (page = image * scale).
        centerImage: {
          x: scaleX ? pageX / scaleX : pageX,
          y: scaleY ? pageY / scaleY : pageY,
        },
      };
    });
    return {
      __type: "PageSense",
      url: pageUrl,
      title: pageTitle,
      shot: {
        image: typeof shot?.image === "string" ? shot.image : null,
        width: shot?.width ?? null,
        height: shot?.height ?? null,
        scaleX,
        scaleY,
        bytes: shot?.bytes ?? null,
        format: shot?.format ?? null,
      },
      nodes,
      nodeCount: rawNodes.length,
      generation: observation?.generation ?? null,
      note: "Hybrid: DOM nodes primary (locator/dom_cua). emitImage(shot.image) for vision. If DOM is ambiguous/covered, match label on nodes then cua.click(center) using page coords (or centerImage * scale).",
    };
  };

  const evaluateReadonly = async (expression) =>
    unwrapValue(await request("evaluateReadonly", { tabId, expression }));
  const playwrightEvaluate = async (pageFunction, arg, options = {}) =>
    unwrapValue(
      await request("playwrightEvaluate", {
        tabId,
        pageFunction:
          typeof pageFunction === "function"
            ? pageFunction.toString()
            : String(pageFunction),
        arg,
        ...options,
      }),
    );

  return Object.freeze({
    id: tabId,
    url,
    title,
    capabilities: createCapabilityCollection([
      "playwright",
      "dom_cua",
      "cua",
      "clipboard",
      "screenshot",
      "sense",
    ]),
    goto,
    back,
    forward,
    reload,
    close,
    screenshot,
    sense,
    evaluate: evaluateReadonly,
    markDeliverable: () => request("markTab", { tabId, deliverable: true }),
    markHandoff: () => request("markTab", { tabId, handoff: true }),
    getJsDialog: () => request("getJsDialog", { tabId }),
    playwright: Object.freeze({
      // Common agent mistakes (page-like API under playwright.*): alias to Tab.
      title,
      url,
      goto,
      back,
      forward,
      reload,
      close,
      screenshot,
      locator: (css) => createLocator(request, tabId, { css }),
      getByRole: (role, options = {}) =>
        createLocator(request, tabId, { role, ...options }),
      getByLabel: (label, options = {}) =>
        createLocator(request, tabId, { label, ...options }),
      getByText: (text, options = {}) =>
        createLocator(request, tabId, { text, ...options }),
      getByPlaceholder: (placeholder, options = {}) =>
        createLocator(request, tabId, { placeholder, ...options }),
      getByTestId: (testId) => createLocator(request, tabId, { testId }),
      frameLocator: (frameSelector) =>
        createFrameLocator(request, tabId, frameSelector),
      evaluate: playwrightEvaluate,
      waitForTimeout: (timeoutMs) =>
        request("waitForTimeout", { tabId, timeoutMs }),
      waitForURL: (targetUrl, options = {}) =>
        request("waitForURL", { tabId, url: targetUrl, ...options }),
      waitForLoadState: (options = {}) =>
        request("waitForLoadState", { tabId, ...options }),
      waitForEvent: (event, options = {}) =>
        request("waitForEvent", { tabId, event, ...options }),
      expectNavigation: async (action, options = {}) => {
        const pending = request("waitForNavigation", { tabId, ...options });
        const value = await action();
        await pending;
        return value;
      },
      domSnapshot: () => request("domSnapshot", { tabId }),
      elementInfo: (options = {}) =>
        request("elementInfo", { tabId, ...options }),
      elementScreenshot: (options = {}) =>
        request("elementScreenshot", { tabId, ...options }),
    }),
    dom_cua: Object.freeze({
      observe: (options = {}) => request("domObserve", { tabId, ...options }),
      get_visible_dom: (options = {}) =>
        request("domObserve", { tabId, ...options }),
      click: (ref) => request("domAction", { tabId, action: "click", ref }),
      double_click: (ref) =>
        request("domAction", { tabId, action: "doubleClick", ref }),
      type: (ref, value) =>
        request("domAction", { tabId, action: "type", ref, value }),
      scroll: (ref, deltaY) =>
        request("domAction", { tabId, action: "scroll", ref, deltaY }),
      keypress: (options = {}) =>
        request("domAction", { tabId, action: "keypress", ...options }),
      downloadMedia: (options = {}) =>
        request("domAction", { tabId, action: "downloadMedia", ...options }),
    }),
    cua: Object.freeze({
      click: (point) => coordinateAction("click", point),
      doubleClick: (point) => coordinateAction("doubleClick", point),
      double_click: (point) => coordinateAction("doubleClick", point),
      drag: (input) => coordinateAction("drag", input),
      scroll: (input) => coordinateAction("scroll", input),
      type: (text) =>
        coordinateAction("type", typeof text === "string" ? { text } : text),
      keypress: (key) =>
        coordinateAction(
          "keypress",
          typeof key === "string" ? { key } : key,
        ),
      move: (point) => coordinateAction("move", point),
      downloadMedia: (options = {}) =>
        coordinateAction("downloadMedia", options),
    }),
    dialog: Object.freeze({
      accept: (promptText) =>
        request("dialogAction", { tabId, action: "accept", promptText }),
      dismiss: () => request("dialogAction", { tabId, action: "dismiss" }),
    }),
    clipboard: Object.freeze({
      read: async () => {
        const result = await request("clipboardRead", { tabId });
        if (Array.isArray(result?.items)) return result.items;
        const text = result?.text ?? "";
        return text
          ? [{ entries: [{ mime_type: "text/plain", text }], presentation_style: "unspecified" }]
          : [];
      },
      readText: async () => {
        const result = await request("clipboardRead", { tabId });
        return result?.text ?? "";
      },
      write: (items) => request("clipboardWrite", { tabId, items }),
      writeText: (text) => request("clipboardWrite", { tabId, text }),
    }),
    content: Object.freeze({
      export: (options = {}) => request("exportContent", { tabId, ...options }),
      exportGsuite: (type, options = {}) =>
        request("exportContent", { tabId, type, ...options }),
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
  const browserId = info.browserId ?? info.backend ?? "in-app";
  const capabilityIds = Array.isArray(info.capabilities)
    ? info.capabilities.map((item) =>
        typeof item === "string" ? item : String(item?.id ?? item),
      )
    : ["tabs", "screenshot", "input", "dialog", "clipboard"];

  return Object.freeze({
    browserId,
    name: browserId,
    capabilities: createCapabilityCollection(capabilityIds),
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
      finalize: (input) => {
        const tabs = Array.isArray(input)
          ? input
          : Array.isArray(input?.tabs)
            ? input.tabs
            : [];
        return request("finalizeTabs", {
          tabIds: tabs.map((tab) => (typeof tab === "string" ? tab : tab.id)),
        });
      },
      content: (input, options = {}) => {
        if (typeof input === "string") {
          return request("tabContent", { tabId: input, ...options });
        }
        return request("tabContent", { ...(input ?? {}), ...options });
      },
    }),
    user: Object.freeze({
      openTabs: async () => {
        const result = await request("listUserTabs", {});
        return result.tabs ?? [];
      },
      claimTab: async (tabIdOrInfo) => {
        const tabId =
          typeof tabIdOrInfo === "string"
            ? tabIdOrInfo
            : tabIdOrInfo?.tabId ?? tabIdOrInfo?.id;
        const result = await request("claimTab", { tabId });
        return createTab(request, result.tab);
      },
      history: (options = {}) => request("history", options),
    }),
    documentation: async (topic) => {
      const result = await request("documentation", {
        topic: topic ?? "api",
      });
      return result?.markdown ?? result?.content ?? JSON.stringify(result ?? {});
    },
    nameSession: (name) => request("nameSession", { name }),
  });
}

export function setupBrowserRuntime(options) {
  if (typeof options?.request !== "function") {
    throw new TypeError("browser request transport is required");
  }
  if (!options.context || typeof options.context !== "object") {
    throw new TypeError("browser execution context is required");
  }
  const request = (method, params) =>
    options.request(method, params, options.context);
  const getDefault = async () =>
    createBrowser(request, await request("getInfo", {}));

  const browsers = Object.freeze({
    list: async () => {
      const browser = await getDefault();
      return [
        {
          id: browser.browserId,
          name: browser.name,
          type: "iab",
          capabilities: {
            browser: (await browser.capabilities.list()).map((item) => ({
              id: item.id,
              description: item.description,
            })),
            tab: [],
          },
        },
      ];
    },
    get: async (name) => {
      const key = String(name ?? "").trim().toLowerCase();
      if (!IN_APP_BROWSER_IDS.has(key) && key !== "") {
        return null;
      }
      return getDefault();
    },
    getDefault,
    getForUrl: async () => getDefault(),
  });

  const documentation = Object.freeze({
    get: async (name) => {
      const result = await request("documentation", { topic: name });
      return result?.markdown ?? result?.content ?? "";
    },
  });

  const agent = Object.freeze({
    browsers,
    documentation,
  });

  if (options.globals && typeof options.globals === "object") {
    options.globals.agent = {
      ...(options.globals.agent ?? {}),
      browsers,
      documentation,
    };
  }

  return agent;
}
