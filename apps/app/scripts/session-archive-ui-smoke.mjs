#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const evidenceRoot = resolve(repoRoot, ".loop/evidence/session-archive-agentsview-parity/M34");
const token = "m34-client-token";
const hostToken = "m34-host-token";
const chromePath = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const serverLog = [];
const viteLog = [];
const chromeLog = [];

async function main() {
  await mkdir(evidenceRoot, { recursive: true });
  const tempRoot = await mkdtemp(join(tmpdir(), "studio-session-archive-m34-"));
  const workspaceRoot = join(tempRoot, "workspace");
  const dataRoot = join(tempRoot, "runtime-state");
  const sourceRoot = join(tempRoot, "empty-agent-sources");
  const chromeProfile = join(tempRoot, "chrome-profile");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(dataRoot, { recursive: true });
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(chromeProfile, { recursive: true });

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
  ], { cwd: repoRoot, env: { ...process.env, ...isolatedAgentSourceEnv(sourceRoot), ONMYAGENT_DATA_DIR: dataRoot, ONMYAGENT_LOG_FORMAT: "json" } }, serverLog);

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
    if (process.env.KEEP_M34_TEMP !== "1") await rm(tempRoot, { recursive: true, force: true });
  };

  let page = null;
  try {
    await waitForHttp(`${serverBaseUrl}/health`, { authorization: `Bearer ${token}` });
    await waitForHttp(appBaseUrl);
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);

    const workspaceList = await fetchJson(`${serverBaseUrl}/workspaces`);
    const workspaceId = workspaceList.items?.[0]?.id;
    assert.ok(typeof workspaceId === "string" && workspaceId.length > 0, "workspace id should be available");

    await seedArchiveData(serverBaseUrl, workspaceId);
    page = await connectChrome(cdpPort);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    await page.send("Page.navigate", { url: `${appBaseUrl}/assistant` });
    await page.waitForLoad();
    await page.evaluate(`localStorage.setItem('onmyagent.server.urlOverride', ${JSON.stringify(serverBaseUrl)});
localStorage.setItem('onmyagent.server.token', ${JSON.stringify(token)});
localStorage.setItem('onmyagent.server.hostToken', ${JSON.stringify(hostToken)});
localStorage.setItem('onmyagent.agentManagement.activePanel', 'archive');
localStorage.setItem('onmyagent.preferences', JSON.stringify({ hasCompletedOnboarding: true }));`);
    await page.send("Page.navigate", { url: `${appBaseUrl}/workspace/${encodeURIComponent(workspaceId)}/assistant` });
    await page.waitForLoad();

    const report = { tempRoot, serverBaseUrl, appBaseUrl, workspaceId, checks: [] };
    const check = async (name, fn) => {
      await fn();
      report.checks.push({ name, ok: true });
    };

    await check("archive list", async () => {
      await page.waitFor(() => Boolean(document.querySelector('[data-view-id="agentManagement"]')), 30000);
      await page.clickSelector('[data-view-id="agentManagement"]');
      await page.waitFor(() => document.body.innerText.includes('会话归档') || document.body.innerText.includes('Session archive'), 30000);
      await page.clickAriaOrText(["会话归档", "Session archive"]);
      await page.waitFor(() => document.querySelectorAll('[data-session-archive-session-id]').length >= 5, 30000);
      await page.clickSelector('[data-session-archive-session-id="m34-codex-long"]');
      await screenshot(page, "archive-list-after.png");
      const count = await page.evaluate(`document.querySelectorAll('[data-session-archive-session-id]').length`);
      assert.ok(count >= 5, `expected archive rows, got ${count}`);
    });

    await check("grouping", async () => {
      await page.clickText("项目");
      await page.waitFor(() => document.body.innerText.includes('M34 Project Alpha'), 10000);
      await screenshot(page, "grouping-after.png");
      await page.clickText("Agent");
      await page.waitFor(() => Boolean(document.querySelector('[data-session-archive-agent-filter-option="hermes"]')), 10000);
    });

    await check("global search", async () => {
      await page.fillFirstInput("Hermes M34 global search title");
      await page.waitFor(() => document.body.innerText.includes('搜索命中') || document.body.innerText.includes('Search matches'), 15000);
      await page.waitFor(() => document.body.innerText.includes('Hermes M34 global search title'), 15000);
      await screenshot(page, "global-search-after.png");
      await page.clickText("Hermes M34 global search title");
      await page.waitFor(() => Boolean(document.querySelector('[data-session-archive-find-input="true"]')), 10000);
    });

    await check("in-session find", async () => {
      await page.fillFirstInput("");
      await page.waitFor(() => Boolean(document.querySelector('[data-session-archive-session-id="m34-codex-long"]')), 15000);
      await page.clickSelector('[data-session-archive-session-id="m34-codex-long"]');
      await page.waitFor(() => Boolean(document.querySelector('[data-session-archive-find-input="true"]')), 15000);
      await page.fillSelector('[data-session-archive-find-input="true"]', "M34_FIND_TARGET_160");
      await page.waitFor(() => document.body.innerText.includes('1 / 1') || document.body.innerText.includes('1/1'), 15000);
      await screenshot(page, "in-session-find-after.png");
    });

    await check("message pagination", async () => {
      const before = await page.evaluate(`document.querySelectorAll('[data-session-archive-virtual-message-list="true"] article').length`);
      await page.clickText("加载更早消息").catch(async () => page.clickText("Load older messages"));
      await page.waitFor(() => document.body.innerText.includes('M34 long user message 0') || document.body.innerText.includes('M34 long assistant response 0'), 15000);
      await screenshot(page, "message-pagination-after.png");
      const after = await page.evaluate(`document.querySelectorAll('[data-session-archive-virtual-message-list="true"] article').length`);
      assert.ok(after >= before, `rendered message rows should not shrink after loading older messages (${before} -> ${after})`);
    });

    await check("virtualization DOM bounds", async () => {
      const metrics = await page.evaluate(`(() => ({
        sessionRows: document.querySelectorAll('[data-session-archive-session-id]').length,
        messageRows: document.querySelectorAll('[data-session-archive-virtual-message-list="true"] article').length,
      }))()`);
      await screenshot(page, "virtualization-after.png");
      assert.ok(metrics.sessionRows < 80, `virtualized session DOM should stay bounded, got ${metrics.sessionRows}`);
      assert.ok(metrics.messageRows < 80, `virtualized message DOM should stay bounded, got ${metrics.messageRows}`);
      report.virtualization = metrics;
    });

    await check("Trash", async () => {
      await page.clickSelector('[data-session-archive-session-id="m34-claude-trash"]');
      await page.clickAriaOrText(["移到回收站", "Move to trash"]);
      await page.clickDialogConfirm();
      await page.waitFor(() => document.body.innerText.includes('已移到回收站') || document.body.innerText.includes('Moved to trash'), 15000).catch(() => {});
      await page.clickAriaOrText(["回收站", "Trash"]);
      await page.waitFor(() => Boolean(document.querySelector('[data-session-archive-trash-session-id="m34-claude-trash"]')), 15000);
      await page.waitFor(() => Boolean(document.querySelector('[data-session-archive-trash-agent-filter-option="claude"]')), 10000);
      await screenshot(page, "trash-after.png");
    });

    await check("sync status", async () => {
      await page.clickText("归档").catch(async () => page.clickText("Archive"));
      await page.clickText("同步").catch(async () => page.clickText("Sync"));
      await page.waitFor(() => document.body.innerText.includes('已同步') || document.body.innerText.includes('Synced') || document.body.innerText.includes('正在同步') || document.body.innerText.includes('Syncing'), 20000);
      await screenshot(page, "sync-status-after.png");
      const bodyText = await page.evaluate(`document.body.innerText`);
      assert.ok(!String(bodyText).includes('Request timed out'), "sync should not time out");
    });

    await writeFile(join(evidenceRoot, "result.json"), JSON.stringify(report, null, 2));
    await writeFile(join(evidenceRoot, "command-output.txt"), [
      "pnpm --filter @onmyagent/app test:app session-archive-ui-smoke",
      "status: PASS",
      `server: ${serverBaseUrl}`,
      `app: ${appBaseUrl}`,
      `workspaceId: ${workspaceId}`,
      `checks: ${report.checks.map((item) => item.name).join(', ')}`,
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
    } catch {
      // Best-effort failure evidence.
    }
    await writeFile(join(evidenceRoot, "command-output.txt"), [
      "pnpm --filter @onmyagent/app test:app session-archive-ui-smoke",
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

async function seedArchiveData(baseUrl, workspaceId) {
  const sessions = buildFixtureSessions();
  for (const session of sessions) {
    await fetchJson(`${baseUrl}/workspace/${encodeURIComponent(workspaceId)}/session-archive/sessions/upload`, {
      method: "POST",
      body: JSON.stringify({
        filename: `${session.id}.jsonl`,
        agent: session.agent,
        project: session.project,
        content: session.messages.map((message) => JSON.stringify({
          session_id: session.id,
          role: message.role,
          content: message.content,
          timestamp: message.timestamp,
        })).join("\n"),
      }),
    });
  }
}

function buildFixtureSessions() {
  const now = Date.parse("2026-06-24T12:00:00.000Z");
  const base = [
    ["m34-hermes-search", "hermes", "M34 Project Alpha", "Hermes M34 global search title", "M34_GLOBAL_UNIQUE_HERMES visible search content"],
    ["m34-openclaw", "openclaw", "M34 Project Beta", "OpenClaw M34 browser task", "OpenClaw archive parity content"],
    ["m34-claude-trash", "claude", "M34 Project Alpha", "Claude M34 trash target", "Claude trash target content"],
    ["m34-aider", "aider", "M34 Project Gamma", "Aider M34 edit trace", "Aider fixture content"],
    ["m34-reasonix", "reasonix", "M34 Project Gamma", "Reasonix M34 reasoning trace", "Reasonix fixture content"],
  ];
  const sessions = base.map(([id, agent, project, title, content], index) => ({
    id,
    agent,
    project,
    messages: [
      { role: "user", content: title, timestamp: new Date(now + index * 1000).toISOString() },
      { role: "assistant", content, timestamp: new Date(now + index * 1000 + 500).toISOString() },
    ],
  }));
  const longMessages = [];
  for (let index = 0; index < 620; index += 1) {
    longMessages.push({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `${index % 2 === 0 ? 'M34 long user message' : 'M34 long assistant response'} ${index}${index === 160 ? ' M34_FIND_TARGET_160' : ''}`,
      timestamp: new Date(now + 10_000 + index * 1000).toISOString(),
    });
  }
  sessions.unshift({ id: "m34-codex-long", agent: "codex", project: "M34 Project Alpha", messages: longMessages });
  return sessions;
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
    const ok = await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.scrollIntoView({block:'center', inline:'center'}); el.click(); return true; })()`);
    assert.equal(ok, true, `selector not found: ${selector}`);
    await wait(250);
  };
  const clickText = async (text) => {
    const ok = await evaluate(`(() => {
      const needle = ${JSON.stringify(text)};
      const nodes = Array.from(document.querySelectorAll('button,[role="button"],a,input,textarea,summary'));
      const el = nodes.find((node) => (node.innerText || node.value || node.getAttribute('aria-label') || '').includes(needle));
      if (!el) return false;
      el.scrollIntoView({block:'center', inline:'center'});
      el.click();
      return true;
    })()`);
    if (!ok) throw new Error(`text target not found: ${text}`);
    await wait(300);
  };
  const clickAriaOrText = async (texts) => {
    for (const text of texts) {
      try {
        await clickText(text);
        return;
      } catch {
        // try the next locale.
      }
    }
    throw new Error(`none of text targets found: ${texts.join(', ')}`);
  };
  const clickDialogConfirm = async () => {
    const ok = await evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]') || document.querySelector('[data-slot="dialog-content"]');
      if (!dialog) return false;
      const buttons = Array.from(dialog.querySelectorAll('button'));
      const button = buttons[buttons.length - 1];
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert.equal(ok, true, "dialog confirm button should exist");
    await wait(400);
  };
  const fillSelector = async (selector, value) => {
    const ok = await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      el.scrollIntoView({block:'center', inline:'center'});
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(value)});
      else el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert.equal(ok, true, `selector not found for fill: ${selector}`);
    await wait(500);
  };
  const fillFirstInput = async (value) => {
    const ok = await evaluate(`(() => {
      const el = document.querySelector('aside input');
      if (!el) return false;
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(value)});
      else el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert.equal(ok, true, "archive search input should exist");
    await wait(800);
  };
  return { send, evaluate, waitForLoad, waitFor, clickSelector, clickText, clickAriaOrText, clickDialogConfirm, fillSelector, fillFirstInput };
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
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${url} failed: ${response.status} ${await response.text()}`);
  return response.json();
}

async function httpJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
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
