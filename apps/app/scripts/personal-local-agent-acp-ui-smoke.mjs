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
  const vite = spawnProcess("corepack", ["pnpm", "--filter", "@onmyagent/app", "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], { cwd: repoRoot, env: process.env }, viteLog);
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
    await page.evaluate(`(() => { ${smokeBootstrap} })()`);
    await page.send("Page.navigate", { url: `${appBaseUrl}/#/workspace/ws_local_agent_acp_smoke/assistant` });
    await page.waitForLoad();
    await page.evaluate(`(() => { ${smokeBootstrap} })()`);
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

    await page.clickAria(["ACP sessions", "ACP session"]);
    await page.waitForText("ACP Smoke Session", 10000);
    await page.clickText(["ACP Smoke Session"]);
    await page.waitForText("Loaded provider session", 10000);
    await page.clickAria(["Fork ACP session", "分叉 ACP session"]);
    await page.waitForText("Fork acp-session-loaded", 10000);
    await page.clickAria(["Close ACP session", "关闭 ACP session"]);
    await wait(500);
    await page.clickAria("Mode");
    await page.clickText(["plan"]);
    await page.waitForText("Mode updated", 10000);
    await page.clickAria(["Model", "模型"]);
    await page.clickText(["ark-code-fast"]);
    await page.waitForText("ark-code-fast", 10000);

    await page.clickText(["管理 Agent", "Manage agents"]);
    await page.clickTestId("local-agent-add-custom");
    await page.fillInputByTestId("local-agent-editor-id", "custom-smoke");
    await page.fillInputByTestId("local-agent-editor-name", "Custom Smoke Agent");
    await page.fillInputByTestId("local-agent-editor-command", "custom-smoke-cli");
    await page.fillInputByTestId("local-agent-editor-args", "--acp");
    await page.clickTestId("local-agent-editor-save");
    await page.waitForText("Custom Smoke Agent", 10000);
    await page.clickTestId("local-agent-edit-custom-smoke");
    await page.fillInputByTestId("local-agent-editor-name", "Custom Smoke Agent Updated");
    await page.clickTestId("local-agent-editor-save");
    await page.waitForText("Custom Smoke Agent Updated", 10000);
    await page.clickTestId("local-agent-delete-custom-smoke");
    await page.waitFor(() => window.__LOCAL_AGENT_ACP_SMOKE__?.deletedCustomAgent === true, 10000);
    await page.clickText(["管理 Agent", "Manage agents"]);

    await page.clickText("Codex");
    await page.fillTextarea("/");
    await page.waitForText(["Start a new conversation for this agent", "新建当前 Agent 的会话"], 10000);
    await page.clickTestId("local-agent-slash-new");
    await page.waitFor(() => window.__LOCAL_AGENT_ACP_SMOKE__?.calls.includes('personalLocalAgentConversationCreate'), 10000);
    await page.fillTextarea("");
    await page.clickText("OpenCode");

    await page.fillTextarea("/");
    await page.waitForText("ACP reported help", 10000);
    await page.clickTestId("local-agent-slash-help");
    await page.waitFor(() => {
      const composer = document.querySelector('textarea[data-local-agent-composer="true"]');
      return composer?.value === '/help ';
    }, 10000);
    await page.fillTextarea("");

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
    await page.waitForText("Inspect workspace", 10000);
    await page.waitForText("Reasoning smoke", 10000);
    await page.assertVisibleTestId("local-agent-timeline-body");
    // Shared conversation UI (plan/thinking) — primary + legacy testids.
    await page.assertVisibleTestId("conversation-plan-block");
    await page.assertVisibleTestId("conversation-plan-header");
    await page.assertVisibleTestId("conversation-plan-body");
    await page.assertVisibleTestId("conversation-thinking-block");
    await page.assertVisibleTestId("conversation-thinking-header");
    // Expand thinking if collapsed after completion so the body is visible.
    try {
      await page.assertVisibleTestId("conversation-thinking-body");
    } catch {
      await page.clickTestId("conversation-thinking-header");
      await page.assertVisibleTestId("conversation-thinking-body");
    }
    await page.waitForText("Content-only plan item", 10000);
    await page.waitForText("Provider timeout", 10000);
    await page.waitForText(["上下文用量", "Context usage"], 10000);
    await page.waitForText("10 / 100", 10000);
    await page.clickTestId("local-agent-tips-resolution");
    await page.waitForText("添加自定义 Agent", 10000);
    await page.clickText(["管理 Agent", "Manage agents"]);
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
    assert.equal(visibleStatusCount, 0, "runtime status events should not be displayed in the visible step group");
    const defaultVisibleRunIdCount = await page.evaluate(`Array.from(document.querySelectorAll('body *')).filter((node) => {
      if (!node.textContent?.trim().startsWith('Run ID')) return false;
      const details = node.closest('details');
      return !details || details.open;
    }).length`);
    assert.equal(defaultVisibleRunIdCount, 0, "Run ID should stay inside closed debug details by default");
    await page.waitFor(() => document.querySelectorAll('strong').length > 0, 10000);
    await screenshot(page, "studio-completed.png");

    await page.fillTextarea("approval smoke");
    await page.clickSend();
    await page.waitForText("需要你审批后继续", 15000);
    await page.waitForText(["始终允许", "Always allow"], 10000);
    await screenshot(page, "studio-running.png");
    await page.clickText(["允许一次", "Allow once"]);
    await page.waitForText("ACP approved reply", 15000);

    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.turn`), 4, "mock ACP bridge should receive four sends");
    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.loadedProviderSession`), true, "provider session/load should be triggered from UI");
    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.closedProviderSession`), true, "provider session/close should be triggered from UI");
    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.forkedProviderSession`), true, "provider session/fork should be triggered from UI");
    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.setConfigOption`), true, "config/set should be triggered from UI");
    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.warmedConversation`), true, "conversation warmup should be triggered from UI");
    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.configSets?.some((item) => item.optionId === 'model' && item.value === 'ark-coding-openai/ark-code-fast')`), true, "model selector should update agent config state");
    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.createdCustomAgent`), true, "custom agent create should be triggered from UI");
    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.updatedCustomAgent`), true, "custom agent update should be triggered from UI");
    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.deletedCustomAgent`), true, "custom agent delete should be triggered from UI");
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

    const report = { tempRoot, appBaseUrl, workspaceRoot, prompts, calls: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.calls || []`), configSets: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.configSets || []`), processPolls: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.processPolls`), loadedProviderSession: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.loadedProviderSession`), closedProviderSession: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.closedProviderSession`), forkedProviderSession: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.forkedProviderSession`), setConfigOption: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.setConfigOption`), warmedConversation: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.warmedConversation`), textLength: String(bodyText).length };
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
      await writeFile(join(evidenceRoot, "failure-interactives.json"), JSON.stringify(await page.evaluate(`Array.from(document.querySelectorAll('button,[role="button"],[role="combobox"],a,summary')).map((node) => ({ tag: node.tagName, role: node.getAttribute('role'), aria: node.getAttribute('aria-label'), title: node.getAttribute('title'), text: (node.innerText || node.textContent || '').trim(), disabled: Boolean(node.disabled), rect: (() => { const rect = node.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; })() }))`), null, 2));
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
    const providerSessions = [{ id: 'acp-session-loaded', sessionId: 'acp-session-loaded', title: 'ACP Smoke Session', cwd: workspaceRoot, createdAt: Date.now() - 60000, updatedAt: Date.now(), metadata: { smoke: true } }];
    const capability = { installed: true, authenticated: true, minVersionOk: true, supportsStreaming: true, supportsResume: true, supportsModelOverride: true, supportsPermissionAutoApprove: true, supportsAcp: true, supportsApproval: true, targetKind: 'model', smokePrompt: 'OK', warning: null };
    const modelOptions = [{ id: 'ark-coding-openai/ark-code-latest', label: 'ark-code-latest' }, { id: 'ark-coding-openai/ark-code-fast', label: 'ark-code-fast' }];
    const configOptions = [{ id: 'mode', label: 'Mode', type: 'select', value: 'default', options: ['default', 'plan'] }, { id: 'model', label: 'Model', type: 'select', value: 'ark-coding-openai/ark-code-latest', options: modelOptions.map((item) => ({ value: item.id, label: item.label })) }];
    const sessionCapabilities = { list: {}, load: {}, close: {}, fork: {}, resume: {} };
    const makeAgent = (id, name, command, connectionMode, version) => ({ id, name, provider: id, executablePath: command, model: null, customArgs: [], modelOptions, defaultModel: modelOptions[0].id, connectionMode, status: 'online', version, error: null, capability, handshake: { available_models: modelOptions, available_commands: [{ name: '/help', description: 'ACP reported help' }], config_options: configOptions, agent_capabilities: { loadSession: true, sessionCapabilities, _meta: { supportsAcp: true } } }, lastCheckedAt: Date.now() });
    const makeMetadata = (id, name, command, connectionMode, version) => ({ id, name, backend: id, agent_type: 'acp', agent_source: 'builtin', enabled: true, available: true, command, args: [], connectionMode, status: 'online', error: null, capability, agent_source_info: { binary_name: command, version }, handshake: { available_models: modelOptions, available_commands: [{ name: '/help', description: 'ACP reported help' }], config_options: configOptions, agent_capabilities: { loadSession: true, sessionCapabilities, _meta: { supportsAcp: true } } } });
    const agents = [makeAgent('opencode', 'OpenCode', 'opencode', 'OpenCode ACP session', '1.17.8'), makeAgent('codex', 'Codex', 'codex-acp', 'Codex ACP session', '1.0.1'), makeAgent('claude', 'Claude Code', 'claude-agent-acp', 'Claude Code ACP session', '0.52.0')];
    const metadata = [makeMetadata('opencode', 'OpenCode', 'opencode', 'OpenCode ACP session', '1.17.8'), makeMetadata('codex', 'Codex', 'codex-acp', 'Codex ACP session', '1.0.1'), makeMetadata('claude', 'Claude Code', 'claude-agent-acp', 'Claude Code ACP session', '0.52.0')];
    agents[1].handshake.available_commands = [];
    metadata[1].handshake.available_commands = [];
    const finish = (run, text) => ({ ...run, ok: true, status: 'completed', finishedAt: Date.now(), output: text, events: [...run.events, { type: 'assistant', text, at: Date.now() }] });
    window.__LOCAL_AGENT_ACP_SMOKE__ = { runs, calls: [], configSets: [], processPolls: 0, loadedProviderSession: false, closedProviderSession: false, forkedProviderSession: false, setConfigOption: false, warmedConversation: false, createdCustomAgent: false, updatedCustomAgent: false, deletedCustomAgent: false, get turn() { return turn; } };
    const invokeDesktop = async (command, ...args) => {
      window.__LOCAL_AGENT_ACP_SMOKE__.calls.push(command);
      if (command === 'workspaceList') return { items: [{ id: 'ws_local_agent_acp_smoke', name: 'ACP Smoke Workspace', path: workspaceRoot, workspaceType: 'local' }], selectedId: 'ws_local_agent_acp_smoke' };
      if (command === 'personalLocalAgentAcpAgentsList' || command === 'personalLocalAgentAcpAgentsRefresh' || command === 'personalLocalAgentMetadataList') return { agents: metadata };
      if (command === 'personalLocalAgentsList') return { agents, metadata };
      if (command === 'personalLocalAgentValidate') return agents.find((item) => item.provider === ((args[0] || {}).provider || (args[0] || {}).agent?.provider)) || agents[0];
      if (command === 'personalLocalAgentConversationsList') return { conversations, activeConversationId: conversations[0].id };
      if (command === 'personalLocalAgentConversationCreate') return { conversation: conversations[0] };
      if (command === 'personalLocalAgentConversationWarmup') {
        window.__LOCAL_AGENT_ACP_SMOKE__.warmedConversation = true;
        conversations[0] = { ...conversations[0], providerSessionId: 'acp-session-warm', resumeKey: 'acp-session-warm' };
        return { ok: true, conversation: conversations[0], providerSessionId: 'acp-session-warm', resumeKey: 'acp-session-warm' };
      }
      if (command === 'personalLocalAgentConversationTranscript') return { messages: [] };
      if (command === 'personalLocalAgentNativeSessionsList') return { sessions: [] };
      if (command === 'personalLocalAgentProviderSessionsList') return { sessions: providerSessions };
      if (command === 'personalLocalAgentProviderSessionLoad') {
        window.__LOCAL_AGENT_ACP_SMOKE__.loadedProviderSession = true;
        const loaded = { id: 'conv-loaded-provider-session', title: 'Loaded provider session', provider: 'opencode', agentId: 'opencode', providerSessionId: 'acp-session-loaded', resumeKey: 'acp-session-loaded', workdir: workspaceRoot, createdAt: Date.now(), updatedAt: Date.now(), lastRunId: null, lastStatus: null, source: 'provider-session-load' };
        conversations.unshift(loaded);
        return { sessionId: 'acp-session-loaded', providerSessionId: 'acp-session-loaded', conversation: loaded, raw: { sessionId: 'acp-session-loaded' } };
      }
      if (command === 'personalLocalAgentProviderSessionClose') {
        window.__LOCAL_AGENT_ACP_SMOKE__.closedProviderSession = true;
        const input = args[0] || {};
        const match = conversations.find((item) => item.providerSessionId === input.sessionId || item.id === input.conversationId);
        if (match) { match.providerSessionId = null; match.resumeKey = null; match.lastStatus = 'closed'; }
        return { ok: true, sessionId: input.sessionId, closedConversationIds: match ? [match.id] : [] };
      }
      if (command === 'personalLocalAgentProviderSessionFork') {
        window.__LOCAL_AGENT_ACP_SMOKE__.forkedProviderSession = true;
        const forked = { id: 'conv-forked-provider-session', title: 'Fork acp-session-loaded', provider: 'opencode', agentId: 'opencode', providerSessionId: 'acp-session-loaded-fork', resumeKey: 'acp-session-loaded-fork', workdir: workspaceRoot, createdAt: Date.now(), updatedAt: Date.now(), lastRunId: null, lastStatus: null, source: 'provider-session-fork' };
        conversations.unshift(forked);
        return { sessionId: 'acp-session-loaded-fork', providerSessionId: 'acp-session-loaded-fork', conversation: forked, raw: { sessionId: 'acp-session-loaded-fork' } };
      }
      if (command === 'personalLocalAgentSetAcpConfigOption') {
        window.__LOCAL_AGENT_ACP_SMOKE__.setConfigOption = true;
        const input = args[0] || {};
        window.__LOCAL_AGENT_ACP_SMOKE__.configSets.push({ optionId: input.optionId, value: input.value });
        return { ok: true, sessionId: input.sessionId || 'acp-session-loaded-fork', optionId: input.optionId, value: input.value, confirmation: 'Mode updated', configOptions: [{ id: 'mode', label: 'Mode', type: 'select', value: input.value, options: ['default', 'plan'] }] };
      }
      if (command === 'personalLocalAgentCreateCustomAgent') {
        window.__LOCAL_AGENT_ACP_SMOKE__.createdCustomAgent = true;
        const input = args[0] || {};
        const agentInput = input.agent || {};
        const agent = makeAgent(agentInput.id || input.id || 'custom-smoke', agentInput.name || 'Custom Smoke Agent', agentInput.command || 'custom-smoke-cli', 'Custom ACP session', 'custom');
        agent.provider = 'custom';
        agent.executablePath = agentInput.command || 'custom-smoke-cli';
        agent.customArgs = agentInput.args || [];
        agents.unshift(agent);
        metadata.unshift(makeMetadata(agent.id, agent.name, agent.executablePath, agent.connectionMode, 'custom'));
        return { agent };
      }
      if (command === 'personalLocalAgentUpdateCustomAgent') {
        window.__LOCAL_AGENT_ACP_SMOKE__.updatedCustomAgent = true;
        const input = args[0] || {};
        const agentInput = input.agent || {};
        const index = agents.findIndex((item) => item.id === (agentInput.id || input.id));
        const next = { ...(agents[index] || makeAgent(agentInput.id || input.id || 'custom-smoke', 'Custom Smoke Agent Updated', 'custom-smoke-cli', 'Custom ACP session', 'custom')), name: agentInput.name || 'Custom Smoke Agent Updated', executablePath: agentInput.command || 'custom-smoke-cli', customArgs: agentInput.args || [] };
        if (index >= 0) agents[index] = next;
        const metadataIndex = metadata.findIndex((item) => item.id === next.id);
        if (metadataIndex >= 0) metadata[metadataIndex] = makeMetadata(next.id, next.name, next.executablePath, next.connectionMode, 'custom');
        return { agent: next };
      }
      if (command === 'personalLocalAgentDeleteCustomAgent') {
        window.__LOCAL_AGENT_ACP_SMOKE__.deletedCustomAgent = true;
        const input = args[0] || {};
        const index = agents.findIndex((item) => item.id === input.id);
        if (index >= 0) agents.splice(index, 1);
        const metadataIndex = metadata.findIndex((item) => item.id === input.id);
        if (metadataIndex >= 0) metadata.splice(metadataIndex, 1);
        return { ok: true, deleted: index >= 0 };
      }
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
          { id: 'plan-' + turn, type: 'plan', role: 'assistant', text: 'Inspect workspace', createdAt: now, sourceEventType: 'plan', entries: [{ id: 'p1', title: 'Inspect workspace', status: 'completed', priority: 'high' }, { id: 'p2', content: 'Content-only plan item', status: 'pending' }] },
          { id: 'thinking-' + turn, type: 'thinking', role: 'assistant', text: 'Reasoning smoke', createdAt: now, sourceEventType: 'thinking', status: 'thinking', msgId: 'msg-' + turn },
          { id: 'tool-group-' + turn, type: 'tool_group', role: 'tool', text: 'Tool calls', createdAt: now, sourceEventType: 'tool_group', msgId: 'msg-' + turn, toolCalls: [
            { id: 'tool-search-' + turn, type: 'acp_tool_call', role: 'tool', text: 'fake_search', createdAt: now, sourceEventType: 'acp_tool_call', status: 'completed', msgId: 'msg-' + turn, update: { toolCallId: 'fake-search-' + turn, title: 'fake_search', kind: 'read', status: 'completed', input: '{"query":"local agent smoke"}', output: ['result line 1', 'result line 2'].join('\\n'), locations: [{ path: 'reports/acp-smoke-' + turn + '.md' }] } },
            { id: 'tool-read-' + turn, type: 'acp_tool_call', role: 'tool', text: 'fake_read', createdAt: now, sourceEventType: 'acp_tool_call', status: 'completed', msgId: 'msg-' + turn, update: { toolCallId: 'fake-read-' + turn, title: 'fake_read', kind: 'read', status: 'completed', input: '{"path":"reports/acp-smoke-' + turn + '.md"}', output: '# ACP smoke ' + turn, locations: [{ path: 'reports/acp-smoke-' + turn + '.md' }] } },
          ] },
          { id: 'tips-' + turn, type: 'tips', role: 'system', text: 'Provider timeout', createdAt: now, sourceEventType: 'tips', category: 'error', ownership: 'provider', resolution: { target: 'provider', kind: 'retry', message: 'Retry later' } },
          { id: 'context-usage-' + turn, type: 'context_usage', role: 'system', text: 'acp_context_usage> {"used":10,"total":100}', createdAt: now, sourceEventType: 'status', contextUsage: { used: 10, total: 100, label: null } },
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
