import { randomUUID } from "node:crypto";

import { createBrowserTabRegistry } from "./browser-tab-registry.mjs";
import { createDomCuaRefStore } from "./dom-cua-ref-store.mjs";
import {
  domActionExpression,
  domObservationExpression,
  locatorActionExpression,
  locatorObservationExpression,
} from "./browser-page-runtime.mjs";

const BLOCKED_RAW_CDP_METHODS = new Set([
  "Page.navigate",
  "Browser.setDownloadBehavior",
  "Page.setDownloadBehavior",
  "DOM.setFileInputFiles",
]);

const READONLY_FORBIDDEN_EXPRESSION = /(?:\b(?:process|require|import|eval|Function|WebSocket|fetch|XMLHttpRequest)\b|\b(?:append|appendChild|remove|removeChild|replaceWith|setAttribute|insertAdjacent\w*)\s*\(|(?:^|[^=!<>])=(?!=|>))/;

function assertReadonlyExpression(expression) {
  if (typeof expression !== "string" || !expression.trim()) {
    throw new TypeError("read-only evaluation expression is required");
  }
  if (READONLY_FORBIDDEN_EXPRESSION.test(expression)) {
    throw new Error("read-only evaluation cannot mutate the page or access host capabilities");
  }
  return expression;
}

function requireContext(context) {
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new TypeError("browser execution context is required");
  }
  if (typeof context.sessionId !== "string" || !context.sessionId) {
    throw new TypeError("browser execution context.sessionId is required");
  }
  if (context.backend !== "in-app") {
    throw new Error("browser backend does not match the in-app host");
  }
  return context;
}

export function createBrowserHost(options) {
  if (typeof options?.createView !== "function") {
    throw new TypeError("createView is required");
  }
  const registry = createBrowserTabRegistry();
  const domRefs = createDomCuaRefStore();
  const views = new Map();
  const authorize = options.authorize ?? (async () => undefined);

  const describe = (tab) => {
    const view = views.get(tab.tabId);
    return {
      ...tab,
      title: view?.webContents.getTitle() ?? "",
      url: view?.webContents.getURL() ?? "about:blank",
      visible: options.isViewVisible?.(view, tab) === true,
    };
  };

  const destroyTab = (tabId) => {
    const view = views.get(tabId);
    if (!view) return;
    if (!view.webContents.isDestroyed()) {
      if (view.webContents.debugger.isAttached()) {
        view.webContents.debugger.detach();
      }
      view.webContents.destroy();
    }
    views.delete(tabId);
    options.onTabDestroyed?.(tabId);
  };

  const controllableView = (tabId, sessionId) => {
    registry.assertControllable(tabId, sessionId);
    const view = views.get(tabId);
    if (!view || view.webContents.isDestroyed()) throw new Error(`unknown browser tab: ${tabId}`);
    return view;
  };

  const sendCdp = async (view, method, params = {}) => {
    if (!view.webContents.debugger.isAttached()) view.webContents.debugger.attach("1.3");
    return view.webContents.debugger.sendCommand(method, params);
  };

  const evaluateValue = async (view, expression) => {
    const response = await sendCdp(view, "Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      silent: true,
      userGesture: false,
    });
    if (response?.exceptionDetails) throw new Error("browser page evaluation failed");
    return response?.result?.value ?? null;
  };

  const createTab = async (params, context) => {
    const url = typeof params?.url === "string" && params.url.trim()
      ? params.url.trim()
      : "about:blank";
    await authorize({ kind: "navigate", url, context });
    const tabId = `tab-${randomUUID()}`;
    const view = options.createView();
    views.set(tabId, view);
    const tab = registry.register({
      tabId,
      owner: "agent",
      sessionId: context.sessionId,
      temporary: params?.temporary !== false,
      deliverable: params?.deliverable === true,
      handoff: params?.handoff === true,
    });
    options.onTabCreated?.(tab, view);
    await view.webContents.loadURL(url);
    return { tab: describe(tab) };
  };

  return {
    async dispatch(method, params, contextInput) {
      const context = requireContext(contextInput);
      if (method === "getInfo") {
        return {
          protocolVersion: 1,
          backend: "in-app",
          capabilities: [
            "tabs",
            "cdp",
            "screenshot",
            "input",
            "dialog",
            "clipboard",
            "downloads",
          ],
        };
      }
      if (method === "createTab") return createTab(params, context);
      if (method === "claimTab") {
        const tabId = typeof params?.tabId === "string" ? params.tabId : "";
        const tab = registry.claim(tabId, context.sessionId);
        return { tab: describe(tab) };
      }
      if (method === "listTabs") {
        return { tabs: registry.listForSession(context.sessionId).map(describe) };
      }
      if (method === "executeCdp") {
        const tabId = typeof params?.tabId === "string" ? params.tabId : "";
        const cdpMethod = typeof params?.method === "string" ? params.method : "";
        registry.assertControllable(tabId, context.sessionId);
        if (BLOCKED_RAW_CDP_METHODS.has(cdpMethod)) {
          throw new Error(`${cdpMethod} is blocked by browser host policy`);
        }
        const view = controllableView(tabId, context.sessionId);
        return {
          result: await sendCdp(view, cdpMethod, params?.params ?? {}),
        };
      }
      if (method === "navigate") {
        const tabId = typeof params?.tabId === "string" ? params.tabId : "";
        const url = typeof params?.url === "string" ? params.url : "";
        const view = controllableView(tabId, context.sessionId);
        await authorize({ kind: "navigate", url, context });
        await view.webContents.loadURL(url);
        domRefs.invalidate(tabId);
        return { tab: describe(registry.assertControllable(tabId, context.sessionId)) };
      }
      if (method === "navigateHistory") {
        const tabId = typeof params?.tabId === "string" ? params.tabId : "";
        const view = controllableView(tabId, context.sessionId);
        if (params?.direction === "back") view.webContents.navigationHistory?.goBack?.();
        else if (params?.direction === "forward") view.webContents.navigationHistory?.goForward?.();
        else throw new Error("navigation history direction is invalid");
        domRefs.invalidate(tabId);
        return { ok: true };
      }
      if (method === "reload") {
        const tabId = typeof params?.tabId === "string" ? params.tabId : "";
        const view = controllableView(tabId, context.sessionId);
        view.webContents.reload();
        domRefs.invalidate(tabId);
        return { ok: true };
      }
      if (method === "screenshot") {
        const tabId = typeof params?.tabId === "string" ? params.tabId : "";
        const view = controllableView(tabId, context.sessionId);
        const result = await sendCdp(view, "Page.captureScreenshot", {
          format: params?.format === "jpeg" ? "jpeg" : "png",
        });
        return {
          image: typeof result?.data === "string"
            ? `data:image/${params?.format === "jpeg" ? "jpeg" : "png"};base64,${result.data}`
            : null,
        };
      }
      if (method === "coordinateAction") {
        const tabId = typeof params?.tabId === "string" ? params.tabId : "";
        const view = controllableView(tabId, context.sessionId);
        if (params?.action === "click") {
          await authorize({
            kind: "click",
            engine: "coordinate-cua",
            label: params.label ?? "",
            context,
          });
          const point = { x: params.x, y: params.y, button: "left", clickCount: 1 };
          await sendCdp(view, "Input.dispatchMouseEvent", { type: "mousePressed", ...point });
          await sendCdp(view, "Input.dispatchMouseEvent", { type: "mouseReleased", ...point });
          return { ok: true };
        }
        if (params?.action === "move") {
          await sendCdp(view, "Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: params.x,
            y: params.y,
          });
          return { ok: true };
        }
        if (params?.action === "doubleClick") {
          await authorize({
            kind: "click",
            engine: "coordinate-cua",
            label: params.label ?? "",
            context,
          });
          const point = { x: params.x, y: params.y, button: "left", clickCount: 2 };
          await sendCdp(view, "Input.dispatchMouseEvent", { type: "mousePressed", ...point });
          await sendCdp(view, "Input.dispatchMouseEvent", { type: "mouseReleased", ...point });
          return { ok: true };
        }
        if (params?.action === "drag") {
          const start = params.from ?? {};
          const end = params.to ?? {};
          await sendCdp(view, "Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: start.x,
            y: start.y,
            button: "left",
            buttons: 1,
            clickCount: 1,
          });
          await sendCdp(view, "Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: end.x,
            y: end.y,
            button: "left",
            buttons: 1,
          });
          await sendCdp(view, "Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: end.x,
            y: end.y,
            button: "left",
            buttons: 0,
            clickCount: 1,
          });
          return { ok: true };
        }
        if (params?.action === "scroll") {
          await sendCdp(view, "Input.dispatchMouseEvent", {
            type: "mouseWheel",
            x: params.x ?? 0,
            y: params.y ?? 0,
            deltaX: params.deltaX ?? 0,
            deltaY: params.deltaY ?? 0,
          });
          return { ok: true };
        }
        if (params?.action === "type") {
          await sendCdp(view, "Input.insertText", { text: String(params.text ?? "") });
          return { ok: true };
        }
        if (params?.action === "keypress") {
          const key = String(params.key ?? "");
          await sendCdp(view, "Input.dispatchKeyEvent", { type: "keyDown", key });
          await sendCdp(view, "Input.dispatchKeyEvent", { type: "keyUp", key });
          return { ok: true };
        }
        throw new Error(`unsupported coordinate action: ${params?.action}`);
      }
      if (method === "evaluateReadonly") {
        const tabId = typeof params?.tabId === "string" ? params.tabId : "";
        const view = controllableView(tabId, context.sessionId);
        const expression = assertReadonlyExpression(params?.expression);
        return { value: await evaluateValue(view, `(() => { const value = (${expression}); return value; })()`) };
      }
      if (method === "locatorAction") {
        const tabId = typeof params?.tabId === "string" ? params.tabId : "";
        const view = controllableView(tabId, context.sessionId);
        const candidates = await evaluateValue(view, locatorObservationExpression(params?.selector ?? {}));
        if (!Array.isArray(candidates) || candidates.length !== 1) {
          throw new Error(`locator matched ${Array.isArray(candidates) ? candidates.length : 0} elements; expected exactly 1`);
        }
        const target = candidates[0];
        if (target.visible !== true) throw new Error("locator target is not visible");
        if (["fill", "type"].includes(params?.action) && target.editable !== true) {
          throw new Error("locator target is not editable");
        }
        if (target.hitTarget !== true) throw new Error("locator target is covered");
        if (params?.action === "count") return { value: 1 };
        if (params?.action === "textContent") return { value: target.label ?? "" };
        await authorize({
          kind: params?.action === "click" ? "click" : "page-action",
          engine: "locator",
          label: target.label ?? "",
          context,
        });
        await evaluateValue(view, locatorActionExpression(params?.selector ?? {}, params?.action, params));
        domRefs.invalidate(tabId);
        return { ok: true };
      }
      if (method === "domObserve") {
        const tabId = typeof params?.tabId === "string" ? params.tabId : "";
        const view = controllableView(tabId, context.sessionId);
        const nodes = await evaluateValue(view, domObservationExpression());
        return domRefs.observe(tabId, Array.isArray(nodes) ? nodes : []);
      }
      if (method === "domAction") {
        const tabId = typeof params?.tabId === "string" ? params.tabId : "";
        const view = controllableView(tabId, context.sessionId);
        const node = domRefs.resolve(tabId, params?.ref);
        await authorize({
          kind: params?.action === "click" ? "click" : "page-action",
          engine: "dom-cua",
          label: node.label ?? "",
          context,
        });
        await evaluateValue(view, domActionExpression(node, params?.action, params));
        domRefs.invalidate(tabId);
        return { ok: true };
      }
      if (method === "tabContent") {
        const tabId = typeof params?.tabId === "string" ? params.tabId : "";
        const view = controllableView(tabId, context.sessionId);
        return { text: await evaluateValue(view, "document.documentElement.innerText") };
      }
      if (method === "dialogAction") {
        const tabId = typeof params?.tabId === "string" ? params.tabId : "";
        const view = controllableView(tabId, context.sessionId);
        await sendCdp(view, "Page.handleJavaScriptDialog", {
          accept: params?.action === "accept",
          promptText: params?.promptText,
        });
        return { ok: true };
      }
      if (method === "clipboardRead") {
        controllableView(typeof params?.tabId === "string" ? params.tabId : "", context.sessionId);
        return { text: options.clipboard?.readText?.() ?? "" };
      }
      if (method === "clipboardWrite") {
        controllableView(typeof params?.tabId === "string" ? params.tabId : "", context.sessionId);
        options.clipboard?.writeText?.(String(params?.text ?? ""));
        return { ok: true };
      }
      if (method === "selectedTab") {
        const tabId = options.getSelectedTabId?.() ?? registry.listForSession(context.sessionId)[0]?.tabId;
        return { tab: tabId ? describe(registry.get(tabId)) : null };
      }
      if (method === "listUserTabs") {
        return { tabs: registry.list().filter((tab) => tab.owner === "user").map(describe) };
      }
      if (method === "history") return { items: await options.history?.(params ?? {}) ?? [] };
      if (method === "documentation") return { topic: params?.topic ?? null, available: true };
      if (method === "nameSession") {
        await options.nameSession?.(context.sessionId, String(params?.name ?? ""));
        return { ok: true };
      }
      if (method === "consoleLogs") return { entries: options.consoleLogs?.(params?.tabId) ?? [] };
      if (method === "moveMouse") {
        return this.dispatch("coordinateAction", { ...params, action: "move" }, context);
      }
      if (method === "finalizeTabs") {
        const tabIds = Array.isArray(params?.tabIds)
          ? params.tabIds.filter((tabId) => typeof tabId === "string")
          : [];
        const closedTabIds = registry.finalize(context.sessionId, tabIds);
        for (const tabId of closedTabIds) destroyTab(tabId);
        return { closedTabIds };
      }
      if (method === "turnEnded") {
        const closedTabIds = registry.turnEnded(context.sessionId);
        for (const tabId of closedTabIds) destroyTab(tabId);
        return { closedTabIds };
      }
      if (method === "sessionDeleted") {
        const closedTabIds = registry.sessionDeleted(context.sessionId);
        for (const tabId of closedTabIds) destroyTab(tabId);
        return { closedTabIds };
      }
      throw new Error(`unsupported browser RPC method: ${method}`);
    },
    destroy() {
      for (const tab of registry.list()) destroyTab(tab.tabId);
      domRefs.clear();
    },
    registerUserTab(tabId, view) {
      views.set(tabId, view);
      const tab = registry.register({
        tabId,
        owner: "user",
        sessionId: null,
        temporary: false,
      });
      options.onTabCreated?.(tab, view);
      return tab;
    },
    describeTab(tabId) {
      return describe(registry.get(tabId));
    },
    listAllTabs() {
      return registry.list().map(describe);
    },
    getView(tabId) {
      return views.get(tabId) ?? null;
    },
    closeUserTab(tabId) {
      const tab = registry.get(tabId);
      if (tab.owner !== "user") throw new Error(`browser tab ${tabId} is not a user tab`);
      registry.remove(tabId);
      destroyTab(tabId);
      return tabId;
    },
  };
}
