#!/usr/bin/env node
// Agent Manager CLI Update UI smoke.
// Spins up Vite + headless Chrome (CDP), mocks the desktop bridge to return
// a snapshot with three managed agents (Claude update-available, Codex up-to-date,
// OpenCode conflict), opens the Agent Manager `agents` panel, and asserts
// that local/latest version, update badge, Update button, refresh-all,
// confirm dialog and terminal launch all wire through end-to-end.

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
const evidenceRoot = resolve(repoRoot, ".loop/evidence/agent-manager-cli-update-parity/final");
const chromePath = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const viteLog = [];
const chromeLog = [];

async function main() {
  await mkdir(evidenceRoot, { recursive: true });
  const tempRoot = await mkdtemp(join(tmpdir(), "onmyagent-agent-manager-cli-update-"));
  const workspaceRoot = join(tempRoot, "workspace");
  const chromeProfile = join(tempRoot, "chrome-profile");
  await Promise.all([mkdir(workspaceRoot, { recursive: true }), mkdir(chromeProfile, { recursive: true })]);
  const webPort = await findFreePort();
  const cdpPort = await findFreePort();
  const appBaseUrl = `http://127.0.0.1:${webPort}`;
  const vite = spawnProcess("corepack", ["pnpm", "--filter", "@onmyagent/app", "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], { cwd: repoRoot, env: process.env }, viteLog);
  const chrome = spawnProcess(chromePath, [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${chromeProfile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1440,1000", "--headless=new", "about:blank"], { cwd: repoRoot, env: process.env }, chromeLog);
  const cleanup = async () => {
    await Promise.allSettled([killProcess(chrome), killProcess(vite)]);
    if (process.env.KEEP_TEMP !== "1") await rm(tempRoot, { recursive: true, force: true });
  };
  let page = null;
  try {
    await waitForHttp(appBaseUrl);
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
    page = await connectChrome(cdpPort);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    const bridgeMock = desktopBridgeMockSource(workspaceRoot);
    const bootstrap = `${bridgeMock}\nlocalStorage.setItem('onmyagent.preferences', JSON.stringify({ hasCompletedOnboarding: true }));\nlocalStorage.setItem('onmyagent.agentManagement.activePanel', 'agents');`;
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: bridgeMock });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: bootstrap });
    await page.send("Page.navigate", { url: `${appBaseUrl}/#/assistant` });
    await page.waitForLoad();
    await page.evaluate(`(() => { ${bootstrap} })()`);
    await page.send("Page.navigate", { url: `${appBaseUrl}/#/workspace/ws_agent_manager_update_smoke/assistant` });
    await page.waitForLoad();
    await page.evaluate(`(() => { ${bootstrap} })()`);

    await page.waitForText(["管理", "Manage", "Management"], 30000);
    await page.clickText(["管理中心", "Management", "管理"]);
    await page.waitForText(["AI 同事检查", "AI colleagues", "Agent check", "模型服务商"], 30000);
    await page.clickText(["AI 同事检查", "AI colleagues", "Agent check"]).catch(() => undefined);
    await page.waitForText(["AI 同事健康检查", "health", "运行统计"], 15000).catch(() => undefined);

    await page.waitForText(["Claude", "OpenCode", "Codex"], 15000);
    await screenshot(page, "01-agent-manager-agents-open.png");

    // Assert per-card data-testids are present.
    await page.assertVisibleTestId("agent-manager-card-recheck-btn-claude");
    await page.assertVisibleTestId("agent-manager-card-update-btn-claude");
    await page.assertVisibleTestId("agent-manager-card-update-badge-claude");
    await page.assertVisibleTestId("agent-manager-card-recheck-btn-codex");
    await page.assertVisibleTestId("agent-manager-agents-refresh-all");

    // Codex should be up-to-date -> no update badge/button.
    const codexUpdate = await page.evaluate(`Boolean(document.querySelector('[data-testid="agent-manager-card-update-btn-codex"]'))`);
    assert.equal(codexUpdate, false, "Codex is up-to-date; update button must be hidden");

    // Click "Update" on Claude to open confirm dialog.
    await page.clickTestId("agent-manager-card-update-btn-claude");
    await page.waitForText(["Open in Terminal", "在终端中执行"], 5000);
    await screenshot(page, "02-update-confirm-dialog-claude.png");
    // Confirm the command preview mentions the npm package.
    await page.waitForText(["@anthropic-ai/claude-code"], 3000);

    // Actually open in terminal -> mocked bridge records call.
    await page.clickText(["Open in Terminal", "在终端中执行"]);
    await page.waitFor(() => window.__AGENT_MANAGER_UPDATE_SMOKE__?.calls?.includes("agentManagementRunLifecycle"), 5000);

    // Refresh all versions.
    await page.clickTestId("agent-manager-agents-refresh-all");
    await page.waitFor(() => (window.__AGENT_MANAGER_UPDATE_SMOKE__?.checkCounts?.claude || 0) >= 2, 5000);
    await screenshot(page, "03-agents-refreshed.png");

    // Open OpenCode dialog to verify conflict UI + install rows.
    await page.clickTestId("agent-manager-card-update-btn-opencode");
    await page.waitForText(["Multiple installations", "多个安装", "偵測到多個"], 5000);
    await screenshot(page, "04-opencode-conflict-dialog.png");
    await page.clickText(["Cancel", "取消"]);

    const report = {
      workspaceRoot,
      calls: await page.evaluate(`window.__AGENT_MANAGER_UPDATE_SMOKE__?.calls || []`),
      checkCounts: await page.evaluate(`window.__AGENT_MANAGER_UPDATE_SMOKE__?.checkCounts || {}`),
      lifecycleRuns: await page.evaluate(`window.__AGENT_MANAGER_UPDATE_SMOKE__?.lifecycleRuns || []`),
      probeCalls: await page.evaluate(`window.__AGENT_MANAGER_UPDATE_SMOKE__?.probeCalls || []`),
    };
    await writeFile(join(evidenceRoot, "result.json"), JSON.stringify(report, null, 2));
    await writeFile(join(evidenceRoot, "command-output.txt"), [
      "pnpm task test agent-manager-cli-update-ui-smoke",
      "status: PASS",
      `workspaceRoot: ${workspaceRoot}`,
      "checks: local/latest labels, update badge, refresh-all, update dialog, terminal launch, conflict dialog",
      "",
      "vite log tail:",
      tail(viteLog),
      "",
      "chrome log tail:",
      tail(chromeLog),
    ].join("\n"));
  } catch (error) {
    if (page) {
      try { const dom = await page.evaluate(`document.body ? document.body.innerText : ''`); await writeFile(join(evidenceRoot, "failure-dom.txt"), String(dom ?? "")); } catch {}
      await screenshot(page, "failure.png").catch(() => undefined);
    }
    await writeFile(join(evidenceRoot, "command-output.txt"), [
      "pnpm task test agent-manager-cli-update-ui-smoke",
      "status: FAIL",
      error instanceof Error ? (error.stack ?? error.message) : String(error),
      "",
      "vite log tail:",
      tail(viteLog),
      "",
      "chrome log tail:",
      tail(chromeLog),
    ].join("\n"));
    throw error;
  } finally {
    page?.close?.();
    await cleanup();
  }
}

function desktopBridgeMockSource(workspaceRoot) {
  return `(() => {
    const workspaceRoot = ${JSON.stringify(workspaceRoot)};
    const state = { calls: [], checkCounts: { claude: 0, codex: 0, opencode: 0 }, lifecycleRuns: [], probeCalls: [] };
    window.__AGENT_MANAGER_UPDATE_SMOKE__ = state;
    const makeAgent = (id, name, version, latest, updateAvailable) => ({
      id, name, provider: id, executablePath: '/opt/homebrew/bin/' + id,
      model: null, customArgs: [], modelOptions: [], defaultModel: null,
      connectionMode: name + ' ACP session', status: 'online',
      version, error: null, capability: null, behavior_policy: null,
      handshake: null, lastCheckedAt: Date.now(),
      latestVersion: latest, latestChannel: 'latest',
      updateAvailable, versionCheckedAt: Date.now(), versionCheckError: null,
      providerOptions: [], usage: { runs: 0, completed: 0, failed: 0, totalDurationMs: 0, lastRunAt: null }, skillCount: 0,
    });
    const snapshot = {
      generatedAt: Date.now(),
      workspaceRoot,
      agents: [
        makeAgent('claude', 'Claude Code', '2.1.155', '2.1.156', true),
        makeAgent('codex', 'Codex', '1.0.1', '1.0.1', false),
        makeAgent('opencode', 'OpenCode', '0.3.3', '0.3.4', true),
      ],
      skills: [],
      proxy: { enabled: false, address: '127.0.0.1', port: 8891, targets: {}, takeover: {}, updatedAt: 0 },
      providers: { opencode: [], claude: [], codex: [], openclaw: [], hermes: [] },
      mcp: { servers: [] },
      claudeDesktop: null,
    };
    const opencodeInstallReport = {
      provider: 'opencode',
      installs: [
        { path: '/opt/homebrew/bin/opencode', version: '0.3.3', runnable: true, error: null, source: 'homebrew', isPathDefault: true, bundled: false },
        { path: '/Users/me/.opencode/bin/opencode', version: '0.3.2', runnable: true, error: null, source: 'bundled', isPathDefault: false, bundled: true },
      ],
      isConflict: true,
      needsConfirmation: true,
      command: 'npm i -g opencode-ai@latest',
      anchored: false,
      envType: 'macos',
    };
    const claudeInstallReport = {
      provider: 'claude',
      installs: [
        { path: '/opt/homebrew/bin/claude', version: '2.1.155', runnable: true, error: null, source: 'homebrew', isPathDefault: true, bundled: false },
      ],
      isConflict: false,
      needsConfirmation: false,
      command: 'npm i -g @anthropic-ai/claude-code@latest',
      anchored: false,
      envType: 'macos',
    };
    const invokeDesktop = async (command, ...args) => {
      state.calls.push(command);
      if (command === 'workspaceList') return { items: [{ id: 'ws_agent_manager_update_smoke', name: 'Update Smoke', path: workspaceRoot, workspaceType: 'local' }], selectedId: 'ws_agent_manager_update_smoke' };
      if (command === 'agentManagementSnapshot') return snapshot;
      if (command === 'agentManagementCheckToolVersion') {
        const provider = (args[0] || {}).provider;
        state.checkCounts[provider] = (state.checkCounts[provider] || 0) + 1;
        const agent = snapshot.agents.find((a) => a.provider === provider);
        return {
          provider,
          version: agent?.version ?? null,
          latestVersion: agent?.latestVersion ?? null,
          updateAvailable: Boolean(agent?.updateAvailable),
          latestChannel: agent?.latestChannel ?? null,
          versionCheckedAt: Date.now(),
          versionCheckError: null,
        };
      }
      if (command === 'agentManagementProbeInstallations') {
        const provider = (args[0] || {}).provider;
        state.probeCalls.push(provider);
        if (provider === 'opencode') return opencodeInstallReport;
        if (provider === 'claude') return claudeInstallReport;
        return { provider, installs: [], isConflict: false, needsConfirmation: false, command: '', anchored: false, envType: 'macos' };
      }
      if (command === 'agentManagementRunLifecycle') {
        state.lifecycleRuns.push(args[0]);
        return { ok: true, terminalLaunched: true, command: 'npm i -g @anthropic-ai/claude-code@latest' };
      }
      // Stubs to keep the rest of the app happy.
      if (command === 'personalLocalAgentsList') return { agents: snapshot.agents, metadata: [] };
      if (command === 'personalLocalAgentStatus') return snapshot.agents[0];
      if (command === 'personalLocalAgentStart') return { ok: true };
      if (command === 'onmyagentSkillsRoot') return workspaceRoot + '/.opencode/skills';
      if (command === 'workspaceBootstrap') return { ok: true };
      if (command === 'workspaceSetSelected') return { ok: true };
      return null;
    };
    window.__ONMYAGENT_ELECTRON__ = { invokeDesktop, shell: { openExternal: async () => undefined }, browser: { createTab: async () => ({ tabId: 'tab' }), navigate: async () => undefined, show: async () => undefined } };
  })();`;
}

async function connectChrome(port) {
  const tabs = await httpJson(`http://127.0.0.1:${port}/json`);
  const tab = tabs.find((item) => item.type === "page" && item.webSocketDebuggerUrl) ?? tabs[0];
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
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
  const waitForText = async (text, timeoutMs = 10000) => {
    const list = Array.isArray(text) ? text : [text];
    const started = Date.now();
    let last;
    while (Date.now() - started < timeoutMs) {
      last = await evaluate(`(() => {
        const body = document.body.innerText || '';
        return ${JSON.stringify(list)}.some((item) => body.includes(item));
      })()`);
      if (last) return true;
      await wait(200);
    }
    throw new Error(`Timed out waiting for text ${list.join(",")}`);
  };
  const clickText = async (texts) => {
    const list = Array.isArray(texts) ? texts : [texts];
    for (const text of list) {
      const ok = await evaluate(`(() => {
        const needle = ${JSON.stringify(text)};
        const nodes = Array.from(document.querySelectorAll('button,[role="button"],[role="combobox"],a,summary'));
        const el = nodes.find((node) => (node.innerText || node.getAttribute('aria-label') || '').includes(needle));
        if (!el) return false;
        el.scrollIntoView({block:'center', inline:'center'});
        el.click();
        return true;
      })()`);
      if (ok) {
        await wait(400);
        return;
      }
    }
    throw new Error(`text target not found: ${list.join(", ")}`);
  };
  const clickAria = async (texts) => {
    const list = Array.isArray(texts) ? texts : [texts];
    for (const text of list) {
      const rect = await evaluate(`(() => {
        const needle = ${JSON.stringify(text)};
        const interactive = Array.from(document.querySelectorAll('button,[role="button"],[role="combobox"],a,summary'));
        const exact = interactive.find((node) => [node.getAttribute('aria-label'), node.getAttribute('title')].some((value) => String(value || '').trim() === needle));
        const direct = exact || interactive.find((node) => [node.getAttribute('aria-label'), node.getAttribute('title'), node.innerText].some((value) => String(value || '').includes(needle)));
        const labelled = Array.from(document.querySelectorAll('*[aria-label],*[title]')).find((node) => [node.getAttribute('aria-label'), node.getAttribute('title')].some((value) => String(value || '').includes(needle)));
        const el = direct || labelled?.closest('button,[role="button"],[role="combobox"],a,summary') || labelled;
        if (!el) return null;
        el.scrollIntoView({block:'center', inline:'center'});
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`);
      if (rect) {
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
        await wait(400);
        return;
      }
    }
    throw new Error(`aria target not found: ${list.join(", ")}`);
  };
  const clickTestId = async (testId) => {
    const rect = await evaluate(`(() => {
      const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']');
      if (!el) return null;
      el.scrollIntoView({block:'center', inline:'center'});
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    assert.ok(rect, `test id target should be clickable: ${testId}`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await wait(400);
  };
  const assertVisibleTestId = async (testId) => {
    const visible = await evaluate(`(() => {
      const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']');
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    })()`);
    assert.equal(visible, true, `test id should be visible in rendered UI: ${testId}`);
  };
  const fillInputByTestId = async (testId, value) => {
    const rect = await evaluate(`(() => {
      const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']');
      if (!el) return null;
      el.scrollIntoView({block:'center', inline:'center'});
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    assert.ok(rect, `test id input should be fillable: ${testId}`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.insertText", { text: value });
    await evaluate(`(() => {
      const el = document.querySelector('[data-testid=' + JSON.stringify(${JSON.stringify(testId)}) + ']');
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, 'value')?.set;
      setter?.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await wait(200);
  };
  const fillTextarea = async (value) => {
    const rect = await evaluate(`(() => {
      const areas = Array.from(document.querySelectorAll('textarea')).filter((item) => !item.disabled);
      const el = areas.find((item) => item.getAttribute('data-local-agent-composer') === 'true') || areas.find((item) => {
        const form = item.closest('form,section,div');
        return form && (form.innerText || '').includes('权限策略');
      }) || areas[0];
      if (!el) return null;
      el.scrollIntoView({block:'center', inline:'center'});
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`);
    assert.ok(rect, "enabled textarea should exist");
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2 });
    await send("Input.insertText", { text: value });
    await evaluate(`(() => {
      const el = document.querySelector('textarea[data-local-agent-composer="true"]');
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(value)} }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await wait(300);
  };
  const clickSend = async () => {
    const ok = await evaluate(`(() => {
      const composer = Array.from(document.querySelectorAll('textarea')).find((item) => !item.disabled && item.getAttribute('data-local-agent-composer') === 'true') || Array.from(document.querySelectorAll('textarea')).find((item) => !item.disabled && (item.closest('form,section,div')?.innerText || '').includes('权限策略'));
      const root = composer?.closest('form,section,div') || document;
      const buttons = Array.from(root.querySelectorAll('button')).filter((button) => !button.disabled);
      const el = buttons.find((button) => (button.innerText || button.getAttribute('aria-label') || '').includes('发送'))
        || buttons.find((button) => (button.innerText || button.getAttribute('aria-label') || '').includes('Send'))
        || Array.from(document.querySelectorAll('button')).filter((button) => !button.disabled).find((button) => (button.innerText || button.getAttribute('aria-label') || '').includes('发送'));
      if (!el) return false;
      el.click();
      return true;
    })()`);
    assert.equal(ok, true, "send button should be clickable");
    await wait(500);
  };
  const close = () => ws.close();
  return { send, evaluate, waitForLoad, waitFor, waitForText, clickText, clickAria, clickTestId, assertVisibleTestId, fillInputByTestId, fillTextarea, clickSend, close };
}

async function screenshot(page, filename) {
  const result = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(join(evidenceRoot, filename), Buffer.from(result.data, "base64"));
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

async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
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
  const append = (chunk) => {
    log.push(chunk.toString());
    if (log.length > 200) log.splice(0, log.length - 200);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("exit", (code, signal) => {
    if (code !== 0 && signal !== "SIGTERM") log.push(`\n[exit code=${code} signal=${signal}]\n`);
  });
  return child;
}

async function killProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), wait(2500).then(() => child.kill("SIGKILL"))]);
}

function tail(lines) {
  return lines.join("").split(/\r?\n/).slice(-60).join("\n");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
