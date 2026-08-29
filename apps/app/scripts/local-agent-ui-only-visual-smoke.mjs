#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const evidenceRoot = resolve(repoRoot, ".loop/evidence/local-agent-ui-only-parity");
const chromePath = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));
const viteLog = [];
const chromeLog = [];

function spawnProcess(cmd, args, opts, log) {
  const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk) => log.push(String(chunk)));
  child.stderr.on("data", (chunk) => log.push(String(chunk)));
  return child;
}

async function killProcess(child) {
  if (!child || child.exitCode !== null) return;
  try { child.kill("SIGTERM"); } catch {}
  await wait(200);
  try { child.kill("SIGKILL"); } catch {}
}

async function findFreePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolvePort(port));
    });
    server.on("error", reject);
  });
}

async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 302) return;
    } catch {}
    await wait(200);
  }
  throw new Error(`waitForHttp timeout ${url}`);
}

async function connectChrome(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  const tabs = await response.json();
  const tab = tabs.find((item) => item.type === "page" && item.webSocketDebuggerUrl) ?? tabs[0];
  assert.ok(tab?.webSocketDebuggerUrl, "Chrome CDP tab should expose WebSocket URL");
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    ws.addEventListener("open", resolveOpen, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) callback.reject(new Error(message.error.message || JSON.stringify(message.error)));
    else callback.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolveSend, reject) => {
    const nextId = ++id;
    pending.set(nextId, { resolve: resolveSend, reject });
    ws.send(JSON.stringify({ id: nextId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result?.value;
  };
  const screenshot = async (name) => {
    const captured = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(evidenceRoot, name), Buffer.from(captured.data, "base64"));
  };
  return { send, evaluate, screenshot, close: () => ws.close() };
}

function fixtureHtml() {
  const result = spawnSync("bun", ["scripts/local-agent-ui-only-visual-render.ts"], { cwd: appRoot, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "failed to render UI-only visual fixture");
  return String(result.stdout || "");
}

async function main() {
  await mkdir(evidenceRoot, { recursive: true });
  const html = fixtureHtml();
  assert.ok(html.includes("local-agent-turn-status") || html.includes("local-agent-timeline-body"), "fixture should include turn status or live process");
  assert.ok(html.includes("最终答案：检查完成"), "fixture should include the final answer");
  const tempRoot = await mkdtemp(join(tmpdir(), "local-agent-ui-only-visual-"));
  const chromeProfile = join(tempRoot, "chrome-profile");
  await mkdir(chromeProfile, { recursive: true });
  const webPort = await findFreePort();
  const cdpPort = await findFreePort();
  const appBaseUrl = `http://127.0.0.1:${webPort}`;
  const vite = spawnProcess("corepack", ["pnpm", "--filter", "@onmyagent/app", "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], { cwd: repoRoot, env: process.env }, viteLog);
  const chrome = spawnProcess(chromePath, [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${chromeProfile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1440,1000", "--headless=new", "about:blank"], { cwd: repoRoot, env: process.env }, chromeLog);
  let page = null;
  try {
    await waitForHttp(appBaseUrl);
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
    page = await connectChrome(cdpPort);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Page.navigate", { url: appBaseUrl });
    await wait(1000);
    const layout = await page.evaluate(`(() => {
      const html = ${JSON.stringify(html)};
      const host = document.createElement("div");
      host.id = "local-agent-ui-only-visual-fixture";
      host.style.cssText = "position:fixed;inset:0;z-index:99999;background:var(--dls-background,#fff);overflow:auto;padding:24px;";
      const column = document.createElement("div");
      column.style.cssText = "width:360px;max-width:360px;min-width:0;margin:0 auto;";
      column.innerHTML = html;
      host.appendChild(column);
      document.body.appendChild(host);
      const rect = column.getBoundingClientRect();
      const overflow = Array.from(column.querySelectorAll("*"))
        .filter((node) => node.getBoundingClientRect().width > 0)
        .some((node) => { const child = node.getBoundingClientRect(); return child.right > rect.right + 1.5 || child.left < rect.left - 1.5; });
      return { width: rect.width, scrollWidth: column.scrollWidth, overflow, turnStatus: Boolean(column.querySelector('[data-testid="local-agent-turn-status"]')), processOpen: Boolean(column.querySelector('[data-testid="local-agent-timeline-body"]')), finalText: column.innerText.includes("最终答案：检查完成") };
    })()`);
    assert.equal(layout.width, 360);
    assert.equal(layout.overflow, false, JSON.stringify(layout));
    assert.equal(layout.turnStatus, true);
    assert.equal(layout.processOpen, false);
    assert.equal(layout.finalText, true);
    await page.screenshot("local-agent-ui-only-light-360.png");
    await page.evaluate("document.documentElement.classList.add('dark'); document.documentElement.dataset.theme='dark';");
    await wait(100);
    await page.screenshot("local-agent-ui-only-dark-360.png");
    await page.evaluate("document.documentElement.classList.remove('dark'); document.documentElement.dataset.theme='light'; document.querySelector('#local-agent-ui-only-visual-fixture > div').style.width='720px'; document.querySelector('#local-agent-ui-only-visual-fixture > div').style.maxWidth='720px';");
    await wait(100);
    await page.screenshot("local-agent-ui-only-light-wide.png");
    await writeFile(join(evidenceRoot, "visual-layout.json"), JSON.stringify(layout, null, 2));
    await writeFile(join(evidenceRoot, "visual-command-output.txt"), [
      "pnpm task test local-agent-ui-only-visual-smoke",
      "status: PASS",
      `360px overflow: ${layout.overflow}`,
      "screenshots: local-agent-ui-only-light-360.png, local-agent-ui-only-dark-360.png, local-agent-ui-only-light-wide.png",
      "fixture: production ChatBubble + interleaved LocalAgentTimelineMessage + LocalAgentPlanFold",
      "",
      "vite log tail:",
      viteLog.slice(-20).join(""),
    ].join("\n"));
  } catch (error) {
    await writeFile(join(evidenceRoot, "visual-command-output.txt"), [
      "pnpm task test local-agent-ui-only-visual-smoke",
      "status: FAIL",
      error instanceof Error ? error.stack ?? error.message : String(error),
      "",
      "vite log tail:",
      viteLog.slice(-40).join(""),
      "",
      "chrome log tail:",
      chromeLog.slice(-20).join(""),
    ].join("\n"));
    throw error;
  } finally {
    page?.close?.();
    await Promise.allSettled([killProcess(chrome), killProcess(vite)]);
    await rm(tempRoot, { recursive: true, force: true });
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
