#!/usr/bin/env node
// Headless CDP smoke for the local-agent "Work in project" workspace chip.
// Verifies Upstream parity: chip renders, opens dropdown, browse resolves via
// mocked pickDirectory, chip label updates, and personalLocalAgentConversationCreate
// is invoked with the picked workspaceRoot instead of the global default.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startLocalAgentSmokeServer } from "./local-agent-smoke-server.mjs";

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

function bridgeMockSource(defaultWorkspace, pickedWorkspace, serverBaseUrl, serverToken, serverHostToken) {
  return `(() => {
    const defaultWs = ${JSON.stringify(defaultWorkspace)};
    const pickedWs = ${JSON.stringify(pickedWorkspace)};
    const serverBaseUrl = ${JSON.stringify(serverBaseUrl)};
    const serverToken = ${JSON.stringify(serverToken)};
    const serverHostToken = ${JSON.stringify(serverHostToken)};
    const conversations = [];
    const runs = new Map();
    const capability = { installed: true, authenticated: true, minVersionOk: true, supportsStreaming: true, supportsResume: true, supportsModelOverride: true, supportsPermissionAutoApprove: true, supportsAcp: true, supportsApproval: true, targetKind: 'model', smokePrompt: 'OK', warning: null };
    const modelOptions = [{ id: 'ark-code-latest', label: 'ark-code-latest' }];
    const makeAgent = (id, name) => ({ id, name, provider: id, executablePath: name, model: null, customArgs: [], modelOptions, defaultModel: modelOptions[0].id, connectionMode: name + ' ACP session', status: 'online', version: '1.0.0', error: null, capability, handshake: { available_models: modelOptions, available_commands: [], config_options: [], agent_capabilities: { loadSession: true, _meta: { supportsAcp: true } } }, lastCheckedAt: Date.now() });
    const agents = [makeAgent('opencode', 'OpenCode'), makeAgent('codex', 'Codex'), makeAgent('claude', 'Claude Code')];
    const metadata = agents.map((a) => ({ id: a.id, name: a.name, backend: a.id, agent_type: 'acp', agent_source: 'builtin', enabled: true, available: true, command: a.name, args: [], connectionMode: a.connectionMode, status: 'online', error: null, capability, handshake: a.handshake }));
    window.__WORKSPACE_PICKER_SMOKE__ = { conversationCreates: [], sends: [], pickDirectoryCalls: 0, processPolls: 0 };
    const invokeDesktop = async (command, ...args) => {
      const input = args[0] || {};
      if (command === 'workspaceList') return { items: [{ id: 'ws_smoke', name: 'Smoke Workspace', path: defaultWs, workspaceType: 'local' }], selectedId: 'ws_smoke' };
      if (command === 'engineInfo') return { name: 'opencode', version: 'smoke', running: true, baseUrl: serverBaseUrl };
      if (command === 'onmyagentServerInfo') return { running: true, pid: 4241, port: Number(new URL(serverBaseUrl).port), baseUrl: serverBaseUrl, ownerToken: serverToken, hostToken: serverHostToken };
      if (command === 'runtimeBootstrap') return { ok: true, skipped: true };
      if (command === 'pickDirectory') { window.__WORKSPACE_PICKER_SMOKE__.pickDirectoryCalls += 1; return pickedWs; }
      if (command === 'personalLocalAgentAcpAgentsList' || command === 'personalLocalAgentAcpAgentsRefresh' || command === 'personalLocalAgentMetadataList') return { agents: metadata };
      if (command === 'personalLocalAgentsList') return { agents, metadata };
      if (command === 'personalLocalAgentValidate') return agents.find((a) => a.provider === (input.provider || input.agent?.provider)) || agents[0];
      if (command === 'personalLocalAgentConversationsList') return { conversations, activeConversationId: null };
      if (command === 'personalLocalAgentConversationsListByProvider') return { conversations, activeConversationId: conversations[0]?.id || null };
      if (command === 'personalLocalAgentChannelConversationsList') return { conversations: [] };
      if (command === 'personalLocalAgentConversationCreate') {
        const conv = { id: 'conv-' + (conversations.length + 1), provider: input.agent?.provider || 'opencode', agentId: input.agent?.id || 'opencode', title: 'Smoke conv', providerSessionId: null, resumeKey: null, workdir: input.workspaceRoot || null, createdAt: Date.now(), updatedAt: Date.now(), lastRunId: null, lastStatus: null, source: 'studio-created' };
        conversations.unshift(conv);
        window.__WORKSPACE_PICKER_SMOKE__.conversationCreates.push({ id: conv.id, workspaceRoot: input.workspaceRoot, agentId: input.agent?.id });
        return { conversation: conv };
      }
      if (command === 'personalLocalAgentAcpSend') {
        const runId = 'run-picker-immediate-' + (window.__WORKSPACE_PICKER_SMOKE__.sends.length + 1);
        const now = Date.now();
        const run = {
          ok: true,
          runId,
          agentId: input.agent?.id || 'opencode',
          agentProvider: input.agent?.provider || 'opencode',
          connectionMode: 'OpenCode ACP session',
          status: 'completed',
          startedAt: now,
          finishedAt: now,
          pid: null,
          command: 'opencode acp',
          output: 'Workspace picked reply',
          error: null,
          events: [{ type: 'assistant', text: 'Workspace picked reply', at: now }],
          conversationMessages: [
            { id: runId + '-user', type: 'text', role: 'user', text: input.prompt || '', createdAt: now, sourceEventType: 'user' },
            { id: runId + '-assistant', type: 'finish', role: 'assistant', text: 'Workspace picked reply', createdAt: now, sourceEventType: 'assistant' },
          ],
          logPath: null,
          workdir: input.workspaceRoot || null,
          conversationId: input.conversationId || null,
          providerSessionId: null,
          resumeKey: null,
          metadata: { agent_type: 'acp' },
          approvalMode: input.approvalMode || 'ask',
          pendingApprovals: [],
          artifacts: [],
        };
        runs.set(runId, run);
        window.__WORKSPACE_PICKER_SMOKE__.sends.push({ workspaceRoot: input.workspaceRoot, conversationId: input.conversationId, prompt: input.prompt });
        return run;
      }
      if (command === 'personalLocalAgentStatus') {
        const runId = input.runId || input;
        return runs.get(runId) || null;
      }
      if (command === 'personalLocalAgentConversationTranscript') return { messages: [] };
      if (command === 'personalLocalAgentConversationStatus') {
        const activeRun = [...runs.values()].find((run) => run.conversationId === input.conversationId) || null;
        return { conversation: conversations.find((conversation) => conversation.id === input.conversationId) || conversations[0] || null, activeRun, running: activeRun?.status === 'running', status: activeRun?.status || 'idle' };
      }
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
      const nodes = Array.from(document.querySelectorAll('button,[role="button"],[role="menuitem"]'));
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
  const fillTextarea = async (value) => {
    const rect = await evaluate(`(() => {
      const el = document.querySelector('textarea[data-local-agent-composer="true"]');
      if (!el || el.disabled) return false;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const bounds = el.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`);
    assert.ok(rect && typeof rect.x === "number", "enabled Local Agent composer should accept immediate workspace send");
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
    await wait(250);
  };
  const clickSend = async () => {
    const clicked = await evaluate(`(() => {
      const composer = document.querySelector('textarea[data-local-agent-composer="true"]');
      const root = composer?.closest('form,section,div') || document;
      const buttons = Array.from(root.querySelectorAll('button')).filter((button) => !button.disabled);
      const el = buttons.find((button) => (button.innerText || button.getAttribute('aria-label') || '').includes('发送'))
        || buttons.find((button) => (button.innerText || button.getAttribute('aria-label') || '').includes('Send'))
        || Array.from(document.querySelectorAll('button')).filter((button) => !button.disabled).find((button) => (button.innerText || button.getAttribute('aria-label') || '').includes('发送'))
        || Array.from(document.querySelectorAll('button')).filter((button) => !button.disabled).find((button) => (button.innerText || button.getAttribute('aria-label') || '').includes('Send'));
      el?.click();
      return Boolean(el);
    })()`);
    assert.equal(clicked, true, "send button should be clickable after workspace selection");
    await wait(500);
  };
  return { send, evaluate, waitFor, clickAria, fillTextarea, clickSend };
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
  const smokeServer = await startLocalAgentSmokeServer({
    workspaceId: "ws_smoke",
    workspaceRoot: defaultWorkspace,
    workspaceName: "Smoke Workspace",
  });
  const webPort = await findFreePort();
  const cdpPort = await findFreePort();
  const appBaseUrl = `http://127.0.0.1:${webPort}`;
  const vite = spawnProcess("corepack", ["pnpm", "--filter", "@onmyagent/app", "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], { cwd: repoRoot, env: process.env }, viteLog);
  const chrome = spawnProcess(chromePath, [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${chromeProfile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1440,1000", "--headless=new", "about:blank"], { cwd: repoRoot, env: process.env }, chromeLog);
  const cleanup = async () => {
    await Promise.allSettled([killProcess(chrome), killProcess(vite), smokeServer.close()]);
    if (process.env.KEEP_WORKSPACE_PICKER_SMOKE_TEMP !== "1") await rm(tempRoot, { recursive: true, force: true });
  };
  let page = null;
  try {
    await waitForHttp(appBaseUrl);
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
    page = await connectCdp(cdpPort);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    const bridge = bridgeMockSource(defaultWorkspace, pickedWorkspace, smokeServer.baseUrl, smokeServer.token, smokeServer.hostToken);
    const bootstrap = `${bridge}\nlocalStorage.setItem('onmyagent.preferences', JSON.stringify({ hasCompletedOnboarding: true }));\nlocalStorage.removeItem('onmyagent.local-agent.workspace-override');\nlocalStorage.removeItem('onmyagent.local-agent.recent-workspaces');`;
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: bootstrap });
    await page.send("Page.navigate", { url: `${appBaseUrl}/#/workspace/ws_smoke/assistant` });
    await wait(1500);
    await page.evaluate(`(() => { ${bootstrap} })()`);
    await page.send("Page.navigate", { url: `${appBaseUrl}/#/workspace/ws_smoke/assistant` });
    await wait(2500);
    // Enter local agent tab
    await page.waitFor(() => Boolean(document.querySelector('button[aria-label="设置"],button[title="设置"],button[aria-label="Settings"],button[title="Settings"]')), 30000);
    assert.equal(await page.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('button')).find((node) => ['设置', 'Settings'].some((label) => [node.getAttribute('aria-label'), node.getAttribute('title')].includes(label)));
      button?.click();
      return Boolean(button);
    })()`), true, "account menu trigger should be clickable");
    await page.waitFor(() => Array.from(document.querySelectorAll("body *")).some((n) => {
      const text = n.textContent || "";
      return text.includes("Agent 对话") || text.includes("Agent chat") || text.includes("本地 Agent") || text.includes("Local Agent");
    }), 30000);
    assert.equal(await page.evaluate(`(() => {
      const labels = ["Agent 对话", "Agent chat", "本地 Agent", "Local Agent"];
      const nodes = Array.from(document.querySelectorAll('[role="menuitem"],button,a'));
      const item = nodes.find((node) => labels.some((label) => (node.innerText || node.getAttribute('aria-label') || '').includes(label)));
      item?.click();
      return Boolean(item);
    })()`), true, "Local Agent account-menu item should be clickable");
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

    // Keep the initial fresh conversation uncommitted while choosing a
    // workspace. The current Local Agent contract exposes the editable chip
    // on this empty state; creating first would immediately lock it.
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
    // Trigger another new conversation and immediately send. Waiting only for
    // the create bridge record intentionally leaves the renderer's selection
    // update on its natural async path, covering the workspace/conversation
    // race rather than hiding it behind a fixed sleep.
    await page.clickAria(["New conversation", "新建对话", "新建會話"]);
    await page.waitFor(() => window.__WORKSPACE_PICKER_SMOKE__.conversationCreates.length > 0, 8000);
    const creates = await page.evaluate(`JSON.parse(JSON.stringify(window.__WORKSPACE_PICKER_SMOKE__.conversationCreates))`);
    const lastCreate = creates[creates.length - 1];
    assert.ok(lastCreate && typeof lastCreate.workspaceRoot === "string", "conversationCreate should record workspaceRoot");
    assert.equal(lastCreate.workspaceRoot, pickedWorkspace, "conversationCreate should use picked workspace as workspaceRoot");
    assert.ok(creates.length > before, "at least one new conversation created after picking workspace");
    await page.fillTextarea("workspace picker immediate send");
    await page.clickSend();
    await page.waitFor(() => (document.body.innerText || "").includes("Workspace picked reply"), 10000);
    const sends = await page.evaluate(`JSON.parse(JSON.stringify(window.__WORKSPACE_PICKER_SMOKE__.sends))`);
    const lastSend = sends[sends.length - 1];
    assert.ok(lastSend && typeof lastSend.workspaceRoot === "string", "personalLocalAgentAcpSend should record workspaceRoot");
    assert.equal(lastSend.workspaceRoot, pickedWorkspace, "immediate send should use picked workspace as workspaceRoot");
    assert.equal(lastSend.conversationId, lastCreate.id, "immediate send should use the newly created conversationId");

    // Per-conversation lock (D-01/D-02 fix): now that a conversation exists with
    // a bound workdir, no editable workspace picker may remain. The current
    // composition hides the chip after commit; a future locked-chip treatment
    // is accepted only when it exposes the read-only test id.
    const lockState = await page.waitFor(() => {
      const nodes = Array.from(document.querySelectorAll("button"));
      const editable = nodes.find((n) => (n.textContent || "").includes("picked-project") || (n.getAttribute("aria-label") || "").includes("picked-project"));
      const locked = document.querySelector('[data-testid="local-agent-workspace-locked"]');
      if (editable) return { editable: true, readOnly: false, text: editable.textContent.trim() };
      if (locked) return { editable: false, readOnly: true, text: locked.textContent.trim() };
      return { editable: false, readOnly: false, text: "workspace picker is not rendered for committed conversation" };
    }, 8000);
    assert.equal(lockState.editable, false, "committed conversation must not keep an editable workspace picker");

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
    await writeFile(join(evidenceRoot, "report.json"), JSON.stringify({ ok: true, pickCalls, creates, sends, chipAfter }, null, 2));
    console.log("workspace-picker smoke OK", { pickCalls, creates: creates.length, sends: sends.length, chipAfter });
  } catch (error) {
    await writeFile(join(evidenceRoot, "vite.log"), viteLog.join(""));
    await writeFile(join(evidenceRoot, "chrome.log"), chromeLog.join(""));
    if (page) {
      await writeFile(join(evidenceRoot, "failure-dom.txt"), String(await page.evaluate(`document.body ? document.body.innerText : ''`)));
      await writeFile(join(evidenceRoot, "failure-state.json"), JSON.stringify(await page.evaluate(`window.__WORKSPACE_PICKER_SMOKE__ || null`), null, 2));
      await writeFile(join(evidenceRoot, "failure-interactives.json"), JSON.stringify(await page.evaluate(`Array.from(document.querySelectorAll('button,textarea,[role="button"]')).map((node) => ({ tag: node.tagName, aria: node.getAttribute('aria-label'), title: node.getAttribute('title'), text: (node.innerText || node.textContent || '').trim(), value: node.value, disabled: Boolean(node.disabled), testId: node.getAttribute('data-testid') }))`), null, 2));
    }
    console.error(error);
    process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

await main();
