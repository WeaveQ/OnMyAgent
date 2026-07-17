import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

import { app, BrowserWindow, WebContentsView } from "electron";

import { createElectronBrowserController } from "../electron/browser-runtime/electron-browser-controller.mjs";

const runtimeDir = await mkdtemp(path.join(os.tmpdir(), "onmyagent-browser-smoke-"));
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end("<!doctype html><title>Browser smoke</title><button onclick=\"document.title='Clicked'\">Continue</button>");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("fixture server did not start");

await app.whenReady();
const window = new BrowserWindow({ show: false, width: 900, height: 700 });
const controller = createElectronBrowserController({
  WebContentsView,
  openExternal: async () => undefined,
  requestApproval: async () => true,
});
controller.setMainWindow(window);

const context = {
  workspaceId: "browser-smoke-workspace",
  sessionId: "browser-smoke-session",
  messageId: "browser-smoke-message",
  turnId: "browser-smoke-turn",
  agentId: "browser-smoke-agent",
  backend: "in-app",
};

try {
  const { tab } = await controller.runtime.dispatch("createTab", {
    url: `http://127.0.0.1:${address.port}`,
    temporary: true,
  }, context);
  const evaluated = await controller.runtime.dispatch("evaluateReadonly", {
    tabId: tab.tabId,
    expression: "document.title",
  }, context);
  await controller.runtime.dispatch("locatorAction", {
    tabId: tab.tabId,
    selector: { role: "button", name: "Continue" },
    action: "click",
  }, context);
  const clicked = await controller.runtime.dispatch("evaluateReadonly", {
    tabId: tab.tabId,
    expression: "document.title",
  }, context);
  const observed = await controller.runtime.dispatch("domObserve", { tabId: tab.tabId }, context);
  const screenshot = await controller.runtime.dispatch("screenshot", {
    tabId: tab.tabId,
  }, context);
  await controller.runtime.dispatch("coordinateAction", {
    tabId: tab.tabId,
    action: "move",
    x: 20,
    y: 20,
  }, context);
  const ended = await controller.runtime.dispatch("turnEnded", {}, context);
  if (evaluated.value !== "Browser smoke") throw new Error("read-only evaluation mismatch");
  if (clicked.value !== "Clicked") throw new Error("locator click mismatch");
  if (!observed.nodes.some((node) => node.role === "button")) throw new Error("DOM-CUA observation missing");
  if (!screenshot.image?.startsWith("data:image/png;base64,")) throw new Error("screenshot missing");
  if (!ended.closedTabIds.includes(tab.tabId)) throw new Error("temporary tab leaked");
  process.stdout.write(`${JSON.stringify({ ok: true, evaluated, screenshotBytes: screenshot.image.length })}\n`);
} finally {
  await controller.close();
  window.destroy();
  await new Promise((resolve) => server.close(resolve));
  await rm(runtimeDir, { recursive: true, force: true });
  app.quit();
}
