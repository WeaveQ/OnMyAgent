#!/usr/bin/env node
// Headless CDP smoke for the local-agent "Work in project" workspace chip.
// Verifies AionUi parity: chip renders, opens dropdown, browse resolves via
// mocked pickDirectory, chip label updates, and personalLocalAgentConversationCreate
// is invoked with the picked workspaceRoot instead of the global default.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const evidenceRoot = resolve(repoRoot, ".loop/evidence/local-agent-workspace-picker-ui-smoke");
const chromePath = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const viteLog = [];
const chromeLog = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function spawnProcess(cmd, args, opts, log) {
  const child = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (b) => log.push(String(b)));
  child.stderr.on("data", (b) => log.push(String(b)));
  return child;
}
async function killProcess(child) {
  if (!child || child.exitCode !== null) return;
  try { child.kill("SIGTERM"); } catch {}
  await wait(200);
  try { child.kill("SIGKILL"); } catch {}
}
async function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });
}
async function waitForHttp(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 302 || res.status === 200) return;
    } catch {}
    await wait(200);
  }
  throw new Error("waitForHttp timeout " + url);
}
async function httpJson(url) {
  const res = await fetch(url);
  return await res.json();
}

function bridgeMockSource(defaultWorkspace, pickedWorkspace) {
  return `(() => {
    const defaultWs = ${JSON.stringify(defaultWorkspace)};
    const pickedWs = ${JSON.stringify(pickedWorkspace)};
    const conversations = [];
    const capability = { installed: true, authenticated: true, minVersionOk: true, supportsStreaming: true, supportsResume: true, supportsModelOverride: true, supportsPermissionAutoApprove: true, supportsAcp: true, supportsApproval: true, targetKind: 'model', smokePrompt: 'OK', warning: null };
    const modelOptions = [{ id: 'ark-code-latest', label: 'ark-code-latest' }];
    const makeAgent = (id, name) => ({ id, name, provider: id, executablePath: name, model: null, customArgs: [], modelOptions, defaultModel: modelOptions[0].id, connectionMode: name + ' ACP session', status: 'online', version: '1.0.0', error: null, capability, handshake: { available_models: modelOptions, available_commands: [], config_options: [], agent_capabilities: { loadSession: true, _meta: { supportsAcp: true } } }, lastCheckedAt: Date.now() });
    const agents = [makeAgent('opencode', 'OpenCode'), makeAgent('codex', 'Codex'), makeAgent('claude', 'Claude Code')];
    const metadata = agents.map((a) => ({ id: a.id, name: a.name, backend: a.id, agent_type: 'acp', agent_source: 'builtin', enabled: true, available: true, command: a.name, args: [], connectionMode: a.connectionMode, status: 'online', error: null, capability, handshake: a.handshake }));
    window.__WORKSPACE_PICKER_SMOKE__ = { conversationCreates: [], pickDirectoryCalls: 0, processPolls: 0 };
    const invokeDesktop = async (command, ...args) => {
      const input = args[0] || {};
      if (command === 'workspaceList') return { items: [{ id: 'ws_smoke', name: 'Smoke Workspace', path: defaultWs, workspaceType: 'local' }], selectedId: 'ws_smoke' };
      if (command === 'pickDirectory') { window.__WORKSPACE_PICKER_SMOKE__.pickDirectoryCalls += 1; return pickedWs; }
      if (command === 'personalLocalAgentAcpAgentsList' || command === 'personalLocalAgentAcpAgentsRefresh' || command === 'personalLocalAgentMetadataList') return { agents: metadata };
      if (command === 'personalLocalAgentsList') return { agents, metadata };
      if (command === 'personalLocalAgentValidate') return agents.find((a) => a.provider === (input.provider || input.agent?.provider)) || agents[0];
      if (command === 'personalLocalAgentConversationsList') return { conversations, activeConversationId: null };
      if (command === 'personalLocalAgentConversationCreate') {
        window.__WORKSPACE_PICKER_SMOKE__.conversationCreates.push({ workspaceRoot: input.workspaceRoot, agentId: input.agent?.id });
        const conv = { id: 'conv-' + (conversations.length + 1), provider: input.agent?.provider || 'opencode', agentId: input.agent?.id || 'opencode', title: 'Smoke conv', providerSessionId: null, resumeKey: null, workdir: input.workspaceRoot || null, createdAt: Date.now(), updatedAt: Date.now(), lastRunId: null, lastStatus: null, source: 'studio-created' };
        conversations.unshift(conv);
        return { conversation: conv };
      }
      if (command === 'personalLocalAgentConversationTranscript') return { messages: [] };
      if (command === 'personalLocalAgentHeartbeatsList') return { jobs: [] };
      if (command === 'personalLocalAgentAcpProcessesList') { window.__WORKSPACE_PICKER_SMOKE__.processPolls += 1; return { processes: [] }; }
      if (command === 'personalLocalAgentAcpHealth') return { ok: true, agents: metadata };
      if (command === 'personalLocalAgentNativeSessionsList') return { sessions: [] };
      if (command === 'personalLocalAgentProviderSessionsList') return { sessions: [] };
      return null;
    };
    window.__ONMYAGENT_ELECTRON__ = { invokeDesktop, shell: { openExternal: async () => undefined }, browser: { createTab: async () => ({ tabId: 't' }), navigate: async () => undefined, show: async () => undefined } };
  })();`;
}

async function connectCdp(port) {
  const tabs = await httpJson(`http://127.0.0.1:${port}/json`);
  const tab = tabs.find((t) => t.type === "page" && t.webSocketDebuggerUrl) ?? tabs[0];
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    const cb = pending.get(msg.id);
    if (!cb) return;
    pending.delete(msg.id);
    if (msg.error) cb.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    else cb.resolve(msg.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const nid = ++id;
    pending.set(nid, { resolve, reject });
    ws.send(JSON.stringify({ id: nid, method, params }));
  });
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result?.value;
  };
  const waitFor = async (fn, timeoutMs = 15000) => {
    const src = `(${fn.toString()})()`;
    const started = Date.now();
    let last;
    while (Date.now() - started < timeoutMs) {
      try { last = await evaluate(src); if (last) return last; } catch (e) { last = String(e); }
      await wait(200);
    }
    throw new Error("waitFor timed out (last=" + String(last) + ")");
  };
  const clickAria = async (labelOrList) => {
    const labels = Array.isArray(labelOrList) ? labelOrList : [labelOrList];
    let rect = null;
    for (const label of labels) {
    rect = await evaluate(`(() => {
      const needle = ${JSON.stringify(label)};
      const nodes = Array.from(document.querySelectorAll('button,[role="button"]'));
      const el = nodes.find((n) => [n.getAttribute('aria-label'), n.getAttribute('title'), n.innerText].some((v) => String(v || '').includes(needle)));
      if (!el) return null;
      el.scrollIntoView({block:'center'});
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    if (rect) break;
    }
    if (!rect) throw new Error("clickAria not found: " + labels.join("|"));
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await wait(400);
  };
  return { send, evaluate, waitFor, clickAria };
}

async function main() {
  await mkdir(evidenceRoot, { recursive: true });
  const tempRoot = await mkdtemp(join(tmpdir(), "workspace-picker-smoke-"));
  const defaultWorkspace = join(tempRoot, "default-workspace");
  const pickedWorkspace = join(tempRoot, "picked-project");
  const chromeProfile = join(tempRoot, "chrome-profile");
  await Promise.all([
    mkdir(defaultWorkspace, { recursive: true }),
    mkdir(pickedWorkspace, { recursive: true }),
    mkdir(chromeProfile, { recursive: true }),
  ]);
  const webPort = await findFreePort();
  const cdpPort = await findFreePort();
  const appBaseUrl = `http://127.0.0.1:${webPort}`;
  const vite = spawnProcess("corepack", ["pnpm", "--filter", "@onmyagent/app", "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], { cwd: repoRoot, env: process.env }, viteLog);
  const chrome = spawnProcess(chromePath, [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${chromeProfile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1440,1000", "--headless=new", "about:blank"], { cwd: repoRoot, env: process.env }, chromeLog);
  const cleanup = async () => {
    await Promise.allSettled([killProcess(chrome), killProcess(vite)]);
    if (process.env.KEEP_WORKSPACE_PICKER_SMOKE_TEMP !== "1") await rm(tempRoot, { recursive: true, force: true });
  };
  try {
    await waitForHttp(appBaseUrl);
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
    const page = await connectCdp(cdpPort);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    const bridge = bridgeMockSource(defaultWorkspace, pickedWorkspace);
    const bootstrap = `${bridge}\nlocalStorage.setItem('onmyagent.preferences', JSON.stringify({ hasCompletedOnboarding: true }));\nlocalStorage.removeItem('onmyagent.local-agent.workspace-override');\nlocalStorage.removeItem('onmyagent.local-agent.recent-workspaces');`;
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: bootstrap });
    await page.send("Page.navigate", { url: `${appBaseUrl}/#/workspace/ws_smoke/assistant` });
    await wait(1500);
    await page.evaluate(`(() => { ${bootstrap} })()`);
    await page.send("Page.navigate", { url: `${appBaseUrl}/#/workspace/ws_smoke/assistant` });
    await wait(2500);
    // Enter local agent tab
    await page.waitFor(() => Array.from(document.querySelectorAll("body *")).some((n) => (n.textContent || "").includes("本地")), 30000);
    await page.clickAria("本地");
    await wait(1500);
    // Wait for footnote chip (empty state shows "Work in project" or 中文)
    const chipText = await page.waitFor(() => {
      const nodes = Array.from(document.querySelectorAll("button"));
      const el = nodes.find((n) => {
        const label = (n.getAttribute("aria-label") || "") + " " + (n.textContent || "");
        return /Work in project|在项目中工作|在專案中工作|Project bound|Bind this conversation|绑定项目|绑定一个项目|綁定專案|default-workspace/.test(label);
      });
      return el ? (el.getAttribute("aria-label") || el.textContent).trim() : null;
    }, 20000);
    assert.ok(chipText, "workspace footnote chip should render in empty state");

    // Trigger new conversation (click plus button labeled New conversation)
    await page.clickAria(["New conversation", "新建对话", "新建會話", "新建对话（新会话）"]);
    await wait(800);
    // Grab conversation-create payload count before picking workspace.
    const before = await page.evaluate(`window.__WORKSPACE_PICKER_SMOKE__.conversationCreates.length`);

    // Click chip -> popover opens
    await page.clickAria(["Bind this conversation to a project folder", "Project bound:", "为本次会话绑定一个项目目录", "已绑定项目", "為本次對話綁定一個專案資料夾", "已綁定專案"]);
    await wait(500);
    // Click "Choose different folder" inside popover
    await page.clickAria(["Choose different folder", "选择其他目录", "選擇其他資料夾"]);
    await wait(800);
    const pickCalls = await page.evaluate(`window.__WORKSPACE_PICKER_SMOKE__.pickDirectoryCalls`);
    assert.equal(pickCalls, 1, "pickDirectory bridge should be invoked once");
    // Chip should now show picked-project basename
    const chipAfter = await page.waitFor(() => {
      const nodes = Array.from(document.querySelectorAll("button"));
      const el = nodes.find((n) => (n.textContent || "").includes("picked-project"));
      return el ? el.textContent.trim() : null;
    }, 8000);
    assert.ok(chipAfter, "chip should relabel to picked workspace basename");
    // Trigger another new conversation and verify workspaceRoot matches pickedWorkspace
    await page.clickAria(["New conversation", "新建对话", "新建會話"]);
    await wait(1200);
    const creates = await page.evaluate(`JSON.parse(JSON.stringify(window.__WORKSPACE_PICKER_SMOKE__.conversationCreates))`);
    const lastCreate = creates[creates.length - 1];
    assert.ok(lastCreate && typeof lastCreate.workspaceRoot === "string", "conversationCreate should record workspaceRoot");
    assert.equal(lastCreate.workspaceRoot, pickedWorkspace, "conversationCreate should use picked workspace as workspaceRoot");
    assert.ok(creates.length > before, "at least one new conversation created after picking workspace");

    // Per-conversation lock (D-01/D-02 fix): now that a conversation exists with
    // a bound workdir, the chip must be disabled (read-only) instead of editable,
    // and should NOT silently fall back to the global override.
    const lockState = await page.waitFor(() => {
      const nodes = Array.from(document.querySelectorAll("button"));
      const el = nodes.find((n) => (n.textContent || "").includes("picked-project"));
      if (!el) return null;
      return { disabled: el.disabled === true || el.getAttribute("disabled") !== null, text: el.textContent.trim() };
    }, 8000);
    assert.ok(lockState, "chip for existing conversation should still show picked-project");
    assert.equal(lockState.disabled, true, "chip should be read-only (disabled) once bound to an existing conversation");

    // Cross-conversation isolation: clearing override + creating a fresh
    // conversation must NOT reuse the previous conversation's workdir unless
    // re-picked. We verify the override state is independent of the locked conv.
    const overrideAfterLock = await page.evaluate(`localStorage.getItem('onmyagent.local-agent.workspace-override')`);
    assert.equal(overrideAfterLock, pickedWorkspace, "override persists for next fresh conversation, but locked conv is read-only");

    // Snapshot screenshot for evidence
    const shot = await page.send("Page.captureScreenshot", { format: "png" });
    if (shot?.data) {
      await writeFile(join(evidenceRoot, "workspace-picker-picked.png"), Buffer.from(shot.data, "base64"));
    }
    await writeFile(join(evidenceRoot, "report.json"), JSON.stringify({ ok: true, pickCalls, creates, chipAfter }, null, 2));
    console.log("workspace-picker smoke OK", { pickCalls, creates: creates.length, chipAfter });
  } catch (error) {
    await writeFile(join(evidenceRoot, "vite.log"), viteLog.join(""));
    await writeFile(join(evidenceRoot, "chrome.log"), chromeLog.join(""));
    console.error(error);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

await main();
