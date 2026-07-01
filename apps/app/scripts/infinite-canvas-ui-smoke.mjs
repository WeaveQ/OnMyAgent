#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const evidenceRoot = resolve(repoRoot, ".loop/evidence/infinite-canvas-ui-smoke");
const token = "canvas-smoke-client-token";
const hostToken = "canvas-smoke-host-token";
const chromePath = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const serverLog = [];
const viteLog = [];
const chromeLog = [];

async function main() {
  await mkdir(evidenceRoot, { recursive: true });
  const tempRoot = await mkdtemp(join(tmpdir(), "studio-infinite-canvas-smoke-"));
  const workspaceRoot = join(tempRoot, "workspace");
  const dataRoot = join(tempRoot, "runtime-state");
  const sourceRoot = join(tempRoot, "empty-agent-sources");
  const chromeProfile = join(tempRoot, "chrome-profile");
  await Promise.all([
    mkdir(workspaceRoot, { recursive: true }),
    mkdir(dataRoot, { recursive: true }),
    mkdir(sourceRoot, { recursive: true }),
    mkdir(chromeProfile, { recursive: true }),
  ]);

  const serverPort = await findFreePort();
  const webPort = await findFreePort();
  const cdpPort = await findFreePort();
  const serverBaseUrl = `http://127.0.0.1:${serverPort}`;
  const appBaseUrl = `http://127.0.0.1:${webPort}`;

  const server = spawnProcess("pnpm", [
    "--dir",
    "apps/server",
    "exec",
    "bun",
    "src/cli.ts",
    "--host",
    "127.0.0.1",
    "--port",
    String(serverPort),
    "--token",
    token,
    "--host-token",
    hostToken,
    "--workspace",
    workspaceRoot,
    "--cors",
    "*",
    "--no-log-requests",
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...isolatedAgentSourceEnv(sourceRoot),
      ONMYAGENT_DATA_DIR: dataRoot,
      ONMYAGENT_LOG_FORMAT: "json",
    },
  }, serverLog);

  const vite = spawnProcess("pnpm", [
    "--filter",
    "@onmyagent/app",
    "exec",
    "vite",
    "--host",
    "127.0.0.1",
    "--port",
    String(webPort),
    "--strictPort",
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      VITE_ONMYAGENT_URL: serverBaseUrl,
      VITE_ONMYAGENT_TOKEN: token,
      VITE_ONMYAGENT_HOST_TOKEN: hostToken,
    },
  }, viteLog);

  const chrome = spawnProcess(chromePath, [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${chromeProfile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--window-size=1440,1000",
    "--headless=new",
    "about:blank",
  ], { cwd: repoRoot, env: process.env }, chromeLog);

  const cleanup = async () => {
    await Promise.allSettled([killProcess(chrome), killProcess(vite), killProcess(server)]);
    if (process.env.KEEP_INFINITE_CANVAS_SMOKE_TEMP !== "1") {
      await rm(tempRoot, { recursive: true, force: true });
    }
  };

  let page = null;
  try {
    await waitForHttp(`${serverBaseUrl}/health`, { authorization: `Bearer ${token}` });
    await waitForHttp(appBaseUrl);
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);

    const workspaceList = await fetchJson(`${serverBaseUrl}/workspaces`);
    const workspaceId = workspaceList.items?.[0]?.id;
    assert.ok(typeof workspaceId === "string" && workspaceId.length > 0, "workspace id should be available");

    page = await connectChrome(cdpPort);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Page.navigate", { url: `${appBaseUrl}/assistant` });
    await page.waitForLoad();
    await page.evaluate(`localStorage.setItem('onmyagent.server.urlOverride', ${JSON.stringify(serverBaseUrl)});
localStorage.setItem('onmyagent.server.token', ${JSON.stringify(token)});
localStorage.setItem('onmyagent.server.hostToken', ${JSON.stringify(hostToken)});
localStorage.setItem('onmyagent.preferences', JSON.stringify({ hasCompletedOnboarding: true }));
localStorage.setItem('onmyagent:ui-state:v1', JSON.stringify({ sidePanelState: { ${JSON.stringify(`assistant-draft:${workspaceId}`)}: 'canvas' } }));`);
    await page.send("Page.navigate", { url: `${appBaseUrl}/workspace/${encodeURIComponent(workspaceId)}/assistant` });
    await page.waitForLoad();

    await page.waitFor(() => Boolean(document.querySelector(".tl-container")), 30000);
    await screenshot(page, "canvas-open.png");

    const beforeDraw = await page.canvasMetrics();
    const rect = await page.canvasRect();
    await page.clickPoint(rect.x, rect.y);
    await page.keyPress("d", "KeyD");
    await page.drag(rect.x - 80, rect.y - 40, rect.x + 80, rect.y + 50);
    await page.waitForCanvasMetric((metrics) => metrics.shapeCount > beforeDraw.shapeCount, 8000);
    const afterDraw = await page.canvasMetrics();
    await screenshot(page, "canvas-after-draw.png");

    const bodyText = await page.evaluate(`document.body.innerText`);
    assert.ok(!String(bodyText).trim().startsWith("Application error"), "app should not render an application error");
    assert.ok(String(bodyText).includes("Infinite Canvas") || String(bodyText).includes("无限画布") || String(bodyText).includes("無限畫布"), "canvas panel title should remain visible");

    const report = {
      tempRoot,
      serverBaseUrl,
      appBaseUrl,
      workspaceId,
      beforeDraw,
      afterDraw,
    };
    await writeFile(join(evidenceRoot, "result.json"), JSON.stringify(report, null, 2));
    await writeFile(join(evidenceRoot, "command-output.txt"), [
      "pnpm task test infinite-canvas-ui-smoke",
      "status: PASS",
      `workspaceId: ${workspaceId}`,
      `shape count: ${beforeDraw.shapeCount} -> ${afterDraw.shapeCount}`,
      "",
      "server log tail:",
      tail(serverLog),
      "",
      "vite log tail:",
      tail(viteLog),
      "",
      "chrome log tail:",
      tail(chromeLog),
    ].join("\n"));
  } catch (error) {
    try {
      const text = page ? await page.evaluate(`document.body ? document.body.innerText.slice(0, 12000) : ''`) : "";
      const location = page ? await page.evaluate(`location.href`) : "";
      await writeFile(join(evidenceRoot, "failure-dom.txt"), `location: ${location}\n\n${text}`);
      if (page) await screenshot(page, "failure-after.png");
    } catch {}
    await writeFile(join(evidenceRoot, "command-output.txt"), [
      "pnpm task test infinite-canvas-ui-smoke",
      "status: FAIL",
      error instanceof Error ? error.stack ?? error.message : String(error),
      "",
      "server log tail:",
      tail(serverLog),
      "",
      "vite log tail:",
      tail(viteLog),
      "",
      "chrome log tail:",
      tail(chromeLog),
    ].join("\n"));
    throw error;
  } finally {
    await cleanup();
  }
}

function isolatedAgentSourceEnv(sourceRoot) {
  const env = {};
  for (const name of [
    "CLAUDE_PROJECTS_DIR",
    "COWORK_DIR",
    "CODEX_SESSIONS_DIR",
    "COPILOT_DIR",
    "GEMINI_DIR",
    "MIMOCODE_DIR",
    "OPENCODE_DIR",
    "KILO_DIR",
    "OPENHANDS_CONVERSATIONS_DIR",
    "CURSOR_PROJECTS_DIR",
    "AMP_DIR",
    "ZENCODER_DIR",
    "IFLOW_DIR",
    "VSCODE_COPILOT_DIR",
    "VISUALSTUDIO_COPILOT_DIR",
    "PI_DIR",
    "OMP_DIR",
    "QWEN_PROJECTS_DIR",
    "COMMANDCODE_PROJECTS_DIR",
    "DEEPSEEK_TUI_SESSIONS_DIR",
    "OPENCLAW_DIR",
    "QCLAW_DIR",
    "KIMI_DIR",
    "KIRO_SESSIONS_DIR",
    "KIRO_IDE_DIR",
    "CORTEX_DIR",
    "HERMES_SESSIONS_DIR",
    "ONMYAGENT_PROJECTS_DIR",
    "FORGE_DIR",
    "PIEBALD_DIR",
    "WARP_DIR",
    "POSITRON_DIR",
    "ZED_DIR",
    "ANTIGRAVITY_DIR",
    "ANTIGRAVITY_CLI_DIR",
    "QWENPAW_DIR",
    "GPTME_DIR",
    "SHELLEY_DIR",
    "VIBE_SESSIONS_DIR",
    "AIDER_DIR",
    "REASONIX_DIR",
  ]) {
    env[name] = join(sourceRoot, name.toLowerCase());
  }
  return env;
}

async function connectChrome(port) {
  const tabs = await httpJson(`http://127.0.0.1:${port}/json`);
  const tab = tabs.find((item) => (
    item.type === "page"
    && typeof item.webSocketDebuggerUrl === "string"
    && typeof item.url === "string"
    && !item.url.startsWith("chrome-extension://")
  )) ?? tabs.find((item) => item.type === "page" && typeof item.webSocketDebuggerUrl === "string") ?? tabs[0];
  assert.ok(tab?.webSocketDebuggerUrl, "Chrome CDP tab should expose WebSocket URL");
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message || JSON.stringify(message.error)));
    else callbacks.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const nextId = ++id;
    pending.set(nextId, { resolve, reject });
    ws.send(JSON.stringify({ id: nextId, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const waitForLoad = async () => wait(1000);
  const waitFor = async (fn, timeoutMs = 10000) => {
    const source = `(${fn.toString()})()`;
    const started = Date.now();
    let last;
    while (Date.now() - started < timeoutMs) {
      try {
        last = await evaluate(source);
        if (last) return last;
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await wait(200);
    }
    throw new Error(`Timed out waiting for ${fn.toString()} (last=${String(last)})`);
  };
  const clickSelector = async (selector) => {
    const rect = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({block:'center', inline:'center'});
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    assert.ok(rect, `selector not found: ${selector}`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await wait(300);
  };
  const clickText = async (texts) => {
    const list = Array.isArray(texts) ? texts : [texts];
    for (const text of list) {
      const ok = await evaluate(`(() => {
        const needle = ${JSON.stringify(text)};
        const nodes = Array.from(document.querySelectorAll('button,[role="button"],a,input,textarea,summary'));
        const el = nodes.find((node) => (node.innerText || node.value || node.getAttribute('aria-label') || '').includes(needle));
        if (!el) return false;
        el.scrollIntoView({block:'center', inline:'center'});
        el.click();
        return true;
      })()`);
      if (ok) {
        await wait(300);
        return;
      }
    }
    throw new Error(`text target not found: ${list.join(", ")}`);
  };
  const fillSelector = async (selector, value) => {
    const ok = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({block:'center', inline:'center'});
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
        || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(value)});
      else el.value = ${JSON.stringify(value)};
      if (el._valueTracker) el._valueTracker.setValue('');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert.equal(ok, true, `selector not found for fill: ${selector}`);
    await wait(500);
  };
  const canvasRect = async () => evaluate(`(() => {
    const el = document.querySelector('.tl-container');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
  })()`);
  const clickPoint = async (x, y) => {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await wait(250);
  };
  const keyPress = async (key, code) => {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, text: key, unmodifiedText: key });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key, code });
    await wait(250);
  };
  const drag = async (startX, startY, endX, endY) => {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: startX, y: startY });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: startX, y: startY, button: "left", clickCount: 1 });
    for (let index = 1; index <= 12; index += 1) {
      const x = startX + ((endX - startX) * index) / 12;
      const y = startY + ((endY - startY) * index) / 12;
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
      await wait(20);
    }
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: endX, y: endY, button: "left", clickCount: 1 });
    await wait(1000);
  };
  const canvasMetrics = async () => evaluate(`(() => {
    const countShapes = (value) => {
      if (!value || typeof value !== 'object') return 0;
      let count = value.typeName === 'shape' ? 1 : 0;
      if (Array.isArray(value)) {
        for (const item of value) count += countShapes(item);
        return count;
      }
      for (const item of Object.values(value)) count += countShapes(item);
      return count;
    };
    const entries = Object.entries(localStorage).filter(([key]) => key.startsWith('onmyagent.infiniteCanvas.v1:'));
    const parsedEntries = entries.map(([key, raw]) => {
      const parsed = JSON.parse(raw);
      const serialized = JSON.stringify(parsed?.document || {});
      return {
        key,
        serialized,
        shapeCount: countShapes(parsed?.document || null),
      };
    });
    return {
      storageKey: parsedEntries.map((entry) => entry.key).join(','),
      shapeCount: Math.max(0, ...parsedEntries.map((entry) => entry.shapeCount)),
      hasAiText: parsedEntries.some((entry) => entry.serialized.includes('Smoke AI box')),
      hasPanel: Boolean(document.querySelector('.tl-container')),
      bodyLength: document.body.innerText.length,
    };
  })()`);
  const waitForCanvasMetric = async (predicate, timeoutMs = 10000) => {
    const started = Date.now();
    let metrics = null;
    while (Date.now() - started < timeoutMs) {
      metrics = await canvasMetrics();
      if (predicate(metrics)) return metrics;
      await wait(250);
    }
    throw new Error(`Timed out waiting for canvas metric; last=${JSON.stringify(metrics)}`);
  };
  return {
    send,
    evaluate,
    waitForLoad,
    waitFor,
    clickSelector,
    clickText,
    fillSelector,
    canvasRect,
    clickPoint,
    keyPress,
    drag,
    canvasMetrics,
    waitForCanvasMetric,
  };
}

async function screenshot(page, filename) {
  const result = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(evidenceRoot, filename), Buffer.from(result.data, "base64"));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) throw new Error(`${options.method ?? "GET"} ${url} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

async function waitForHttp(url, headers = {}, timeoutMs = 30000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return;
      lastError = new Error(`${response.status} ${response.statusText}`);
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function findFreePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  assert.ok(address && typeof address !== "string", "expected TCP address");
  return address.port;
}

function spawnProcess(command, args, options, log) {
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  const append = (prefix, chunk) => {
    const text = chunk.toString();
    log.push(`${prefix}${text}`);
    if (log.length > 200) log.splice(0, log.length - 200);
  };
  child.stdout.on("data", (chunk) => append("", chunk));
  child.stderr.on("data", (chunk) => append("", chunk));
  child.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") log.push(`\n[exit code=${code} signal=${signal}]\n`);
  });
  return child;
}

async function killProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    wait(2500).then(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }),
  ]);
}

function tail(log) {
  return log.join("").split(/\r?\n/).slice(-40).join("\n");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
