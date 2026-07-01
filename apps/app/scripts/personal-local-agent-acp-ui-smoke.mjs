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
const evidenceRoot = resolve(repoRoot, ".loop/evidence/personal-local-agent-acp-ui-smoke");
const chromePath = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const viteLog = [];
const chromeLog = [];

async function main() {
  await mkdir(evidenceRoot, { recursive: true });
  const tempRoot = await mkdtemp(join(tmpdir(), "studio-local-agent-acp-ui-"));
  const workspaceRoot = join(tempRoot, "workspace");
  const chromeProfile = join(tempRoot, "chrome-profile");
  await Promise.all([mkdir(workspaceRoot, { recursive: true }), mkdir(chromeProfile, { recursive: true })]);
  const webPort = await findFreePort();
  const cdpPort = await findFreePort();
  const appBaseUrl = `http://127.0.0.1:${webPort}`;
  const vite = spawnProcess("pnpm", ["--filter", "@onmyagent/app", "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], { cwd: repoRoot, env: process.env }, viteLog);
  const chrome = spawnProcess(chromePath, [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${chromeProfile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1440,1000", "--headless=new", "about:blank"], { cwd: repoRoot, env: process.env }, chromeLog);
  const cleanup = async () => {
    await Promise.allSettled([killProcess(chrome), killProcess(vite)]);
    if (process.env.KEEP_LOCAL_AGENT_ACP_SMOKE_TEMP !== "1") await rm(tempRoot, { recursive: true, force: true });
  };
  let page = null;
  try {
    await waitForHttp(appBaseUrl);
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
    page = await connectChrome(cdpPort);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    const bridgeMock = desktopBridgeMockSource(workspaceRoot);
    const smokeBootstrap = `${bridgeMock}\nlocalStorage.setItem('onmyagent.preferences', JSON.stringify({ hasCompletedOnboarding: true }));`;
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: bridgeMock });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: smokeBootstrap });
    await page.send("Page.navigate", { url: `${appBaseUrl}/#/assistant` });
    await page.waitForLoad();
    await page.evaluate(smokeBootstrap);
    await page.send("Page.navigate", { url: `${appBaseUrl}/#/workspace/ws_local_agent_acp_smoke/assistant` });
    await page.waitForLoad();
    await page.evaluate(smokeBootstrap);
    await page.waitForText("本地", 30000);
    await page.clickText(["本地 Agent", "Local Agent", "本地"]);
    await page.waitForText("OpenCode", 30000);
    await page.waitForText("Codex", 30000);
    await page.waitForText("Claude Code", 30000);
    await page.waitForText("OpenCode ACP session", 10000);
    await page.waitForText("Codex ACP session", 10000);
    await page.waitForText("Claude Code ACP session", 10000);
    assert.ok(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.processPolls > 0`), "UI should poll desktop process registry for background Local Agent runs");
    await page.waitForText("后台运行中的本地 Agent", 10000);
    await page.waitForText("run-background-opencode", 10000);
    await screenshot(page, "01-local-agent-open.png");

    const prompts = ["第一轮 ACP UI smoke", "第二轮 **Markdown** smoke", "第三轮 artifact smoke https://example.com/report.md"];
    for (let index = 0; index < prompts.length; index += 1) {
      await page.fillTextarea(prompts[index]);
      await page.clickSend();
      await page.waitForText(`ACP reply ${index + 1}`, 15000);
    }
    await page.waitForText("查看步骤", 10000);
    await page.clickText(["查看步骤"]);
    await page.waitForText("查看步骤 · 2", 10000);
    await page.waitForText("fake_search", 10000);
    await page.waitForText("fake_read", 10000);
    await page.waitForText("reports/acp-smoke", 10000);
    await page.waitForText("Input", 10000);
    await page.waitForText("Output", 10000);
    await page.waitForText("result line 1", 10000);
    await page.waitFor(() => {
      const text = document.body.innerText || '';
      return text.includes('ACP reply 3: **Markdown** ok') || text.includes('ACP reply 3: Markdown ok');
    }, 10000);
    const visibleAssistantSegmentCount = await page.evaluate(`Array.from(document.querySelectorAll('body *')).filter((node) => node.textContent?.trim() === '回复片段').length`);
    assert.equal(visibleAssistantSegmentCount, 0, "assistant streaming chunks should not be labeled as separate visible steps");
    const visibleStatusCount = await page.evaluate(`Array.from(document.querySelectorAll('body *')).filter((node) => node.textContent?.trim() === '状态').length`);
    assert.equal(visibleStatusCount, 0, "runtime status events should not be displayed in the AionUI-style step group");
    await page.waitFor(() => document.querySelectorAll('strong').length > 0, 10000);
    await screenshot(page, "02-three-turns-markdown.png");

    await page.fillTextarea("approval smoke");
    await page.clickSend();
    await page.waitForText("需要你审批后继续", 15000);
    await screenshot(page, "03-approval-card.png");
    await page.clickText(["允许一次", "Allow once"]);
    await page.waitForText("ACP approved reply", 15000);

    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.turn`), 4, "mock ACP bridge should receive four sends");
    await page.clickText(["文件", "Files"]);
    await page.waitForText("工作区", 10000).catch(() => undefined);
    await page.clickText(["本地 Agent", "Local Agent", "本地"]);
    await page.waitForText("ACP approved reply", 10000);
    await screenshot(page, "04-tab-switch-preserved.png");

    const bodyText = await page.evaluate(`document.body.innerText`);
    for (const forbidden of ["Codex app-server session", "Claude Code stream-json session", "OpenClaw local agent JSON session", "OpenCode SDK session"]) {
      assert.equal(String(bodyText).includes(forbidden), false, `old non-ACP label should be absent: ${forbidden}`);
    }
    assert.ok(String(bodyText).includes("OpenCode ACP session"), "OpenCode ACP connection label should be visible");
    assert.ok(String(bodyText).includes("Codex ACP session"), "Codex ACP connection label should be visible");
    assert.ok(String(bodyText).includes("Claude Code ACP session"), "Claude ACP connection label should be visible");
    assert.ok(String(bodyText).includes("ACP approved reply"), "approved ACP reply should remain visible after tab switch");

    const report = { tempRoot, appBaseUrl, workspaceRoot, prompts, calls: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.calls || []`), processPolls: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.processPolls`), textLength: String(bodyText).length };
    await writeFile(join(evidenceRoot, "result.json"), JSON.stringify(report, null, 2));
    await writeFile(join(evidenceRoot, "command-output.txt"), [
      "pnpm task test personal-local-agent-acp-ui-smoke",
      "status: PASS",
      `workspaceRoot: ${workspaceRoot}`,
      "checks: OpenCode/Codex/Claude ACP labels, background process registry restore, 3-turn chat, markdown render, approval card, tab switch preservation, old-label absence",
      "",
      "vite log tail:",
      tail(viteLog),
      "",
      "chrome log tail:",
      tail(chromeLog),
    ].join("\n"));
  } catch (error) {
    if (page) {
      await writeFile(join(evidenceRoot, "failure-dom.txt"), String(await page.evaluate(`document.body ? document.body.innerText : ''`)));
      await writeFile(join(evidenceRoot, "failure-state.json"), JSON.stringify(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__ || null`), null, 2));
      await screenshot(page, "failure.png").catch(() => undefined);
    }
    await writeFile(join(evidenceRoot, "command-output.txt"), [
      "pnpm task test personal-local-agent-acp-ui-smoke",
      "status: FAIL",
      error instanceof Error ? error.stack ?? error.message : String(error),
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

main().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});

function desktopBridgeMockSource(workspaceRoot) {
  return `(() => {
    const workspaceRoot = ${JSON.stringify(workspaceRoot)};
    let turn = 0;
    const runs = new Map();
    const conversations = [{ id: 'conv-acp-smoke', title: 'ACP Smoke', providerSessionId: 'acp-session-1', resumeKey: 'acp-session-1', workdir: workspaceRoot, createdAt: Date.now(), updatedAt: Date.now(), lastRunId: null, lastStatus: null, source: 'studio-created' }];
    const capability = { installed: true, authenticated: true, minVersionOk: true, supportsStreaming: true, supportsResume: true, supportsModelOverride: true, supportsPermissionAutoApprove: true, supportsAcp: true, supportsApproval: true, targetKind: 'model', smokePrompt: 'OK', warning: null };
    const modelOptions = [{ id: 'ark-coding-openai/ark-code-latest', label: 'ark-code-latest' }];
    const makeAgent = (id, name, command, connectionMode, version) => ({ id, name, provider: id, executablePath: command, model: null, customArgs: [], modelOptions, defaultModel: modelOptions[0].id, connectionMode, status: 'online', version, error: null, capability, lastCheckedAt: Date.now() });
    const makeMetadata = (id, name, command, connectionMode, version) => ({ id, name, backend: id, agent_type: 'acp', agent_source: 'builtin', enabled: true, available: true, command, args: [], connectionMode, status: 'online', error: null, capability, agent_source_info: { binary_name: command, version }, handshake: { available_models: modelOptions, available_commands: [{ name: '/help', description: 'ACP reported help' }], config_options: [], agent_capabilities: { _meta: { supportsAcp: true } } } });
    const agents = [makeAgent('opencode', 'OpenCode', 'opencode', 'OpenCode ACP session', '1.17.8'), makeAgent('codex', 'Codex', 'codex-acp', 'Codex ACP session', '1.0.1'), makeAgent('claude', 'Claude Code', 'claude-agent-acp', 'Claude Code ACP session', '0.52.0')];
    const metadata = [makeMetadata('opencode', 'OpenCode', 'opencode', 'OpenCode ACP session', '1.17.8'), makeMetadata('codex', 'Codex', 'codex-acp', 'Codex ACP session', '1.0.1'), makeMetadata('claude', 'Claude Code', 'claude-agent-acp', 'Claude Code ACP session', '0.52.0')];
    const finish = (run, text) => ({ ...run, ok: true, status: 'completed', finishedAt: Date.now(), output: text, events: [...run.events, { type: 'assistant', text, at: Date.now() }] });
    window.__LOCAL_AGENT_ACP_SMOKE__ = { runs, calls: [], processPolls: 0, get turn() { return turn; } };
    const invokeDesktop = async (command, ...args) => {
      window.__LOCAL_AGENT_ACP_SMOKE__.calls.push(command);
      if (command === 'workspaceList') return { items: [{ id: 'ws_local_agent_acp_smoke', name: 'ACP Smoke Workspace', path: workspaceRoot, workspaceType: 'local' }], selectedId: 'ws_local_agent_acp_smoke' };
      if (command === 'personalLocalAgentAcpAgentsList' || command === 'personalLocalAgentAcpAgentsRefresh' || command === 'personalLocalAgentMetadataList') return { agents: metadata };
      if (command === 'personalLocalAgentsList') return { agents, metadata };
      if (command === 'personalLocalAgentValidate') return agents.find((item) => item.provider === ((args[0] || {}).provider || (args[0] || {}).agent?.provider)) || agents[0];
      if (command === 'personalLocalAgentConversationsList') return { conversations, activeConversationId: conversations[0].id };
      if (command === 'personalLocalAgentConversationCreate') return { conversation: conversations[0] };
      if (command === 'personalLocalAgentConversationTranscript') return { messages: [] };
      if (command === 'personalLocalAgentNativeSessionsList') return { sessions: [] };
      if (command === 'personalLocalAgentHeartbeatsList') return { jobs: [] };
      if (command === 'personalLocalAgentResetConversation') return { ok: true, conversation: conversations[0], removed: [] };
      if (command === 'personalLocalAgentAcpSend') {
        const input = args[0] || {};
        if ((window.__LOCAL_AGENT_ACP_SMOKE__.lastPrompt || '') === input.prompt) return runs.get(window.__LOCAL_AGENT_ACP_SMOKE__.lastRunId);
        turn += 1;
        window.__LOCAL_AGENT_ACP_SMOKE__.lastPrompt = input.prompt;
        const now = Date.now();
        const run = {
          ok: false, runId: 'run-acp-' + turn, agentId: 'opencode', agentProvider: 'opencode',
          connectionMode: 'OpenCode ACP session', status: 'running', startedAt: now, finishedAt: null,
          pid: 4242, command: 'opencode acp', output: '', error: null,
          events: [{ type: 'status', text: 'opencode ACP flow started', at: now }, { type: 'log', text: 'pid 4242', at: now }],
          logPath: workspaceRoot + '/run-' + turn + '.jsonl', conversationId: input.conversationId || 'conv-acp-smoke',
          providerSessionId: 'acp-session-1', resumeKey: 'acp-session-1', metadata: { agent_type: 'acp' },
          workdir: workspaceRoot, debugSummary: 'provider=opencode\\nconnection=OpenCode ACP session', errorInfo: null,
          approvalMode: input.approvalMode || 'ask', pendingApprovals: [], artifacts: [], conversationMessages: []
        };
        runs.set(run.runId, run);
        window.__LOCAL_AGENT_ACP_SMOKE__.lastRunId = run.runId;
        if (String(input.prompt || '').includes('approval')) {
          run.pendingApprovals = [{ id: 'approval-' + turn, runId: run.runId, provider: 'opencode', method: 'session/request_permission', kind: 'command', title: 'ACP permission request', summary: 'Run harmless command', command: 'touch /tmp/acp-smoke', cwd: workspaceRoot, readonly: false, params: {}, createdAt: now }];
          run.events.push({ type: 'approval_request', text: 'Run harmless command', at: now, approval: run.pendingApprovals[0] });
          runs.set(run.runId, run);
          return run;
        }
        const text = 'ACP reply ' + turn + ': **Markdown** ok\\n\\nartifact: reports/acp-smoke-' + turn + '.md\\nhttps://example.com/report.md';
        const toolCall = { id: 'fake-search-' + turn, name: 'fake_search', status: 'completed', description: 'query local agent smoke', input: '{"query":"local agent smoke"}', output: ['result line 1', 'result line 2'].join('\\n') };
        const secondToolCall = { id: 'fake-read-' + turn, name: 'fake_read', status: 'completed', description: 'reports/acp-smoke-' + turn + '.md', input: '{"path":"reports/acp-smoke-' + turn + '.md"}', output: '# ACP smoke ' + turn };
        run.events.push({ type: 'tool', text: 'tool_call> fake_search', at: Date.now(), toolCall });
        run.events.push({ type: 'tool', text: 'tool_call> fake_read', at: Date.now(), toolCall: secondToolCall });
        run.events.push({ type: 'assistant_chunk', text: 'ACP reply ' + turn + ': ', at: Date.now() });
        run.events.push({ type: 'assistant_chunk', text: '**Markdown** ok', at: Date.now() });
        const done = finish(run, text);
        done.conversationMessages = [
          { id: 'tool-search-' + turn, type: 'tool', role: 'tool', text: 'fake_search query local agent smoke', createdAt: now, sourceEventType: 'tool', status: 'completed', toolCall },
          { id: 'tool-read-' + turn, type: 'tool', role: 'tool', text: 'fake_read reports/acp-smoke-' + turn + '.md', createdAt: now, sourceEventType: 'tool', status: 'completed', toolCall: secondToolCall },
          { id: 'chunk-1-' + turn, type: 'text', role: 'assistant', text: 'ACP reply ' + turn + ': ', createdAt: now, sourceEventType: 'assistant_chunk' },
          { id: 'chunk-2-' + turn, type: 'text', role: 'assistant', text: '**Markdown** ok', createdAt: now, sourceEventType: 'assistant_chunk' },
          { id: 'finish-' + turn, type: 'finish', role: 'assistant', text, createdAt: now, sourceEventType: 'assistant' },
        ];
        done.artifacts = [{ path: workspaceRoot + '/reports/acp-smoke-' + turn + '.md', relPath: 'reports/acp-smoke-' + turn + '.md', name: 'acp-smoke-' + turn + '.md', source: 'assistant', exists: true, addedAt: now }];
        runs.set(run.runId, done);
        return done;
      }
      if (command === 'personalLocalAgentStatus') return runs.get((args[0] || {}).runId || args[0]) || null;
      if (command === 'personalLocalAgentAcpResolveApproval') {
        const input = args[0] || {};
        const run = runs.get(input.runId);
        if (!run) return { ok: false, error: 'missing run' };
        const done = finish({ ...run, pendingApprovals: [], events: [...run.events, { type: 'approval_decision', text: 'command: accept', at: Date.now() }] }, 'ACP approved reply: **permission** continued');
        runs.set(run.runId, done);
        return { ok: true };
      }
      if (command === 'personalLocalAgentAcpCancel') return { ok: true };
      if (command === 'personalLocalAgentAcpConfigOptions') return { configOptions: [], availableModels: modelOptions, availableCommands: [{ name: '/help', description: 'ACP reported help' }] };
      if (command === 'personalLocalAgentAcpHealth') return { ok: true, agents: metadata };
      if (command === 'personalLocalAgentAcpProcessesList') {
        window.__LOCAL_AGENT_ACP_SMOKE__.processPolls += 1;
        if (!runs.has('run-background-opencode')) {
          const now = Date.now();
          runs.set('run-background-opencode', {
            ok: false, runId: 'run-background-opencode', agentId: 'opencode', agentProvider: 'opencode',
            connectionMode: 'OpenCode ACP session', status: 'running', startedAt: now - 3000, finishedAt: null,
            pid: 42420, command: 'opencode acp', output: '', error: null,
            events: [{ type: 'status', text: 'background smoke run', at: now - 3000 }], logPath: null,
            conversationId: 'conv-acp-smoke', providerSessionId: 'acp-session-1', resumeKey: 'acp-session-1',
            metadata: { agent_type: 'acp' }, workdir: workspaceRoot, debugSummary: 'background smoke', errorInfo: null,
            approvalMode: 'ask', pendingApprovals: [], artifacts: []
          });
        }
        return { processes: [{ runId: 'run-background-opencode', pid: 42420, provider: 'opencode', backend: 'opencode', conversationId: 'conv-background-smoke', agentType: 'acp', command: 'opencode acp', startedAt: Date.now() - 3000, updatedAt: Date.now() }] };
      }
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
    const started = Date.now();
    let last;
    while (Date.now() - started < timeoutMs) {
      last = await evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`);
      if (last) return true;
      await wait(200);
    }
    throw new Error(`Timed out waiting for text ${text}`);
  };
  const clickText = async (texts) => {
    const list = Array.isArray(texts) ? texts : [texts];
    for (const text of list) {
      const ok = await evaluate(`(() => {
        const needle = ${JSON.stringify(text)};
        const nodes = Array.from(document.querySelectorAll('button,[role="button"],a,summary'));
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
  return { send, evaluate, waitForLoad, waitFor, waitForText, clickText, fillTextarea, clickSend, close };
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
