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
const evidenceRoot = resolve(repoRoot, ".loop/evidence/local-agent-approval-overflow");
const chromePath = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const viteLog = [];
const chromeLog = [];
const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms));

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
  throw new Error("waitForHttp timeout " + url);
}

async function httpJson(url) {
  const response = await fetch(url);
  return await response.json();
}

function renderApprovalHtml() {
  const result = spawnSync("bun", ["scripts/local-agent-approval-overflow-render.ts"], {
    cwd: appRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "failed to render approval fixture");
  }
  return String(result.stdout || "");
}

async function connectChrome(port) {
  const tabs = await httpJson(`http://127.0.0.1:${port}/json`);
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
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message || JSON.stringify(message.error)));
    else callbacks.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolveSend, reject) => {
    const nextId = ++id;
    pending.set(nextId, { resolve: resolveSend, reject });
    ws.send(JSON.stringify({ id: nextId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    }
    return result.result?.value;
  };
  const screenshot = async (name) => {
    const captured = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(join(evidenceRoot, name), Buffer.from(captured.data, "base64"));
  };
  return {
    send,
    evaluate,
    screenshot,
    close() {
      try { ws.close(); } catch {}
    },
  };
}

async function main() {
  await mkdir(evidenceRoot, { recursive: true });
  const html = renderApprovalHtml();
  assert.ok(html.includes("local-agent-approval-card"), "fixture should render the local agent approval card");
  assert.equal(html.split("data-testid=\"local-agent-approval-card\"").length - 1, 1, "fixture should contain one approval card");
  const tempRoot = await mkdtemp(join(tmpdir(), "local-agent-approval-overflow-"));
  const chromeProfile = join(tempRoot, "chrome-profile");
  await mkdir(chromeProfile, { recursive: true });
  const webPort = await findFreePort();
  const cdpPort = await findFreePort();
  const appBaseUrl = `http://127.0.0.1:${webPort}`;
  const vite = spawnProcess("corepack", ["pnpm", "--filter", "@onmyagent/app", "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], { cwd: repoRoot, env: process.env }, viteLog);
  const chrome = spawnProcess(chromePath, [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${chromeProfile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=900,900", "--headless=new", "about:blank"], { cwd: repoRoot, env: process.env }, chromeLog);
  const cleanup = async () => {
    await Promise.allSettled([killProcess(chrome), killProcess(vite)]);
    if (process.env.KEEP_APPROVAL_OVERFLOW_SMOKE_TEMP !== "1") await rm(tempRoot, { recursive: true, force: true });
  };
  let page = null;
  try {
    await waitForHttp(appBaseUrl);
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
    page = await connectChrome(cdpPort);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Page.addScriptToEvaluateOnNewDocument", {
      source: "localStorage.setItem('onmyagent.preferences', JSON.stringify({ hasCompletedOnboarding: true }));",
    });
    await page.send("Page.navigate", { url: appBaseUrl });
    await wait(1500);
    const overflow = await page.evaluate(`(() => {
      const html = ${JSON.stringify(html)};
      const host = document.createElement("div");
      host.id = "local-agent-approval-overflow-fixture";
      host.setAttribute("data-testid", "local-agent-approval-overflow-fixture");
      host.style.cssText = "position:fixed;inset:0;z-index:99999;background:#ffffff;overflow:auto;padding:24px;";
      const column = document.createElement("div");
      column.style.cssText = "width:360px;max-width:360px;min-width:0;";
      column.innerHTML = html;
      host.appendChild(column);
      document.body.appendChild(host);
      const columnRect = column.getBoundingClientRect();
      const overflowsColumn = (node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        return rect.right > columnRect.right + 1.5 || rect.left < columnRect.left - 1.5;
      };
      const card = host.querySelector('[data-testid="local-agent-approval-card"]');
      const markdown = host.querySelector(".markdown-content");
      const cardOverflow = card
        ? Array.from(card.querySelectorAll("*")).some(overflowsColumn) || card.scrollWidth > card.clientWidth + 1
        : true;
      const markdownOverflow = markdown
        ? Array.from(markdown.querySelectorAll("*")).some(overflowsColumn) || markdown.scrollWidth > markdown.clientWidth + 1
        : true;
      return {
        count: host.querySelectorAll('[data-testid="local-agent-approval-card"]').length,
        overflow: cardOverflow,
        markdownOverflow,
        scrollWidth: card?.scrollWidth ?? 0,
        clientWidth: card?.clientWidth ?? 0,
        markdownScrollWidth: markdown?.scrollWidth ?? 0,
        markdownClientWidth: markdown?.clientWidth ?? 0,
        columnWidth: columnRect.width,
        text: card?.innerText ?? "",
        markdownText: markdown?.innerText ?? "",
      };
    })()`);
    await page.screenshot("narrow-approval-card.png");
    await writeFile(join(evidenceRoot, "layout.json"), JSON.stringify(overflow, null, 2));
    assert.equal(overflow.count, 1, "narrow fixture should show a single approval card");
    assert.equal(overflow.overflow, false, "approval card children must stay inside a 360px column: " + JSON.stringify(overflow));
    assert.equal(overflow.markdownOverflow, false, "streaming markdown must stay inside a 360px column: " + JSON.stringify(overflow));
    assert.match(String(overflow.text || ""), /需要你审批后继续/);
    assert.match(String(overflow.text || ""), /允许一次/);
    assert.match(String(overflow.text || ""), /本次会话允许/);
    await writeFile(join(evidenceRoot, "command-output.txt"), [
      "pnpm task test local-agent-approval-overflow-smoke",
      "status: PASS",
      `card: ${overflow.clientWidth}x scroll ${overflow.scrollWidth}`,
      `markdown: ${overflow.markdownClientWidth}x scroll ${overflow.markdownScrollWidth}`,
      "",
      "vite log tail:",
      viteLog.slice(-20).join(""),
    ].join("\n"));
  } catch (error) {
    if (page) await page.screenshot("failure.png").catch(() => undefined);
    await writeFile(join(evidenceRoot, "command-output.txt"), [
      "pnpm task test local-agent-approval-overflow-smoke",
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
    await cleanup();
  }
}

main().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
