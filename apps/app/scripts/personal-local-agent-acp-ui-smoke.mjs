#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startLocalAgentSmokeServer } from "./local-agent-smoke-server.mjs";
import {
  connectChrome,
  findFreePort,
  killProcess,
  screenshot as captureScreenshot,
  spawnProcess,
  tail,
  waitForHttp,
} from "./personal-local-agent-acp-ui-smoke-support.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const appRoot = resolve(__dirname, "..");
const repoRoot = resolve(appRoot, "../..");
const evidenceRoot = resolve(repoRoot, ".loop/evidence/personal-local-agent-acp-ui-smoke");
const chromePath = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const viteLog = [];
const chromeLog = [];
const screenshot = (page, filename) => captureScreenshot(page, evidenceRoot, filename);

async function main() {
  await mkdir(evidenceRoot, { recursive: true });
  const tempRoot = await mkdtemp(join(tmpdir(), "studio-local-agent-acp-ui-"));
  const workspaceRoot = join(tempRoot, "workspace");
  const chromeProfile = join(tempRoot, "chrome-profile");
  await Promise.all([mkdir(workspaceRoot, { recursive: true }), mkdir(chromeProfile, { recursive: true })]);
  const uploadPath = join(workspaceRoot, "smoke-upload.txt");
  await Promise.all([
    writeFile(uploadPath, "Local Agent upload smoke\n"),
    writeFile(join(workspaceRoot, "smoke-reference.md"), "# Local Agent mention smoke\n"),
  ]);
  const smokeServer = await startLocalAgentSmokeServer({
    workspaceId: "ws_local_agent_acp_smoke",
    workspaceRoot,
    workspaceName: "ACP Smoke Workspace",
  });
  const webPort = await findFreePort();
  const cdpPort = await findFreePort();
  const appBaseUrl = `http://127.0.0.1:${webPort}`;
  const vite = spawnProcess("corepack", ["pnpm", "--filter", "@onmyagent/app", "exec", "vite", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"], { cwd: repoRoot, env: process.env }, viteLog);
  const chrome = spawnProcess(chromePath, [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${chromeProfile}`, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1440,1000", "--headless=new", "about:blank"], { cwd: repoRoot, env: process.env }, chromeLog);
  const cleanup = async () => {
    await Promise.allSettled([killProcess(chrome), killProcess(vite), smokeServer.close()]);
    if (process.env.KEEP_LOCAL_AGENT_ACP_SMOKE_TEMP !== "1") await rm(tempRoot, { recursive: true, force: true });
  };
  let page = null;
  try {
    await waitForHttp(appBaseUrl);
    await waitForHttp(`http://127.0.0.1:${cdpPort}/json/version`);
    page = await connectChrome(cdpPort);
    await page.send("Page.enable");
    await page.send("Runtime.enable");
    const bridgeMock = desktopBridgeMockSource(workspaceRoot, smokeServer.baseUrl, smokeServer.token, smokeServer.hostToken);
    const smokeBootstrap = `${bridgeMock}\nlocalStorage.setItem('onmyagent.preferences', JSON.stringify({ hasCompletedOnboarding: true }));`;
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: bridgeMock });
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: smokeBootstrap });
    await page.send("Page.navigate", { url: `${appBaseUrl}/#/assistant` });
    await page.waitForLoad();
    await page.evaluate(`(() => { ${smokeBootstrap} })()`);
    await page.send("Page.navigate", { url: `${appBaseUrl}/#/workspace/ws_local_agent_acp_smoke/assistant` });
    await page.waitForLoad();
    await page.evaluate(`(() => { ${smokeBootstrap} })()`);
    await page.waitFor(() => Boolean(document.querySelector('button[aria-label="设置"],button[title="设置"],button[aria-label="Settings"],button[title="Settings"]')), 30000);
    assert.equal(await page.evaluate(`(() => {
      const button = Array.from(document.querySelectorAll('button')).find((node) => ['设置', 'Settings'].some((label) => [node.getAttribute('aria-label'), node.getAttribute('title')].includes(label)));
      button?.click();
      return Boolean(button);
    })()`), true, "account menu trigger should be clickable");
    await page.waitForText(["Agent 对话", "Agent chat", "本地 Agent", "Local Agent"], 30000);
    await page.clickText(["Agent 对话", "Agent chat", "本地 Agent", "Local Agent"]);
    await page.waitForText("OpenCode", 30000);
    await page.waitForText("Codex", 30000);
    await page.waitForText("Claude Code", 30000);
    assert.ok(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.processPolls > 0`), "UI should poll desktop process registry for background Local Agent runs");
    await page.clickAria(["后台运行总览", "Background runs overview"]);
    await page.waitForText(["后台运行总览", "Background runs overview"], 10000);
    await page.waitForText("run-background-opencode", 10000);
    await page.waitForText(["OpenCode ACP session", "连接：OpenCode ACP session", "Connection: OpenCode ACP session"], 10000);
    await page.waitForText(["Codex ACP session", "连接：Codex ACP session", "Connection: Codex ACP session"], 10000);
    await page.waitForText(["Claude Code ACP session", "连接：Claude Code ACP session", "Connection: Claude Code ACP session"], 10000);
    const backgroundOverviewText = await page.evaluate(`document.body.innerText`);
    for (const forbidden of ["Codex app-server session", "Claude Code stream-json session", "OpenClaw local agent JSON session", "OpenCode SDK session"]) {
      assert.equal(String(backgroundOverviewText).includes(forbidden), false, `old non-ACP label should be absent from the background overview: ${forbidden}`);
    }
    await page.clickAria(["Close", "关闭"]);
    await screenshot(page, "01-local-agent-open.png");
    await page.waitFor(() => window.__LOCAL_AGENT_ACP_SMOKE__?.hostStatusPolls > 0, 10000);
    await page.assertVisibleTestId("local-agent-status-rail");
    assert.equal(await page.evaluate(`document.querySelector('[data-testid="local-agent-status-rail-skill"]')?.textContent?.includes('1')`), true, "status rail should render the current workspace skill count");
    assert.equal(await page.evaluate(`document.querySelector('[data-testid="local-agent-status-rail-mcp"]')?.textContent?.includes('1')`), true, "status rail should render the current MCP count");
    await page.waitFor(() => (window.__LOCAL_AGENT_ACP_SMOKE__?.browserPanelListenerCount ?? 0) > 0
      && (window.__LOCAL_AGENT_ACP_SMOKE__?.browserStateListenerCount ?? 0) > 0, 10000);
    await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.emitBrowserAgentTab?.()`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const browserUrlVisible = `Array.from(document.querySelectorAll('input')).some((input) => input.value === 'https://browser-mcp-smoke.example/research')`;
    assert.equal(await page.evaluate(browserUrlVisible), false, "temporary Local Agent Browser work should stay in the background");
    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.browserShowCalls`), 0, "background Browser work should not attach the native viewport");
    await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.markBrowserAgentTabForHandoff?.()`);
    await page.waitFor(() => Array.from(document.querySelectorAll('input'))
      .some((input) => input.value === 'https://browser-mcp-smoke.example/research'), 10000);
    assert.ok(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.browserShowCalls > 0`), "explicit Browser handoff should attach the visible panel");
    await screenshot(page, "local-agent-browser-mcp-handoff-visible.png");
    await page.clickAria(["关闭浏览器面板", "Close browser panel"]);
    await page.clickAria(["Model", "模型"]);
    await page.clickText(["ark-code-fast"]);
    await page.waitForText("ark-code-fast", 10000);
    await page.clickTestId("local-agent-manage-agents");
    await page.waitForText(["我的智能体", "My agents"], 10000);
    assert.ok(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.calls.includes('agentManagementSnapshot')`), "Manage agents should open the canonical agent-management page");
    await page.clickAria(["设置", "Settings"]);
    await page.waitForText(["Agent 对话", "Agent chat", "本地 Agent", "Local Agent"], 10000);
    await page.clickText(["Agent 对话", "Agent chat", "本地 Agent", "Local Agent"]);
    await page.assertVisibleTestId("local-agent-status-rail");

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

    await page.fillTextarea("@smoke");
    await page.assertVisibleTestId("local-agent-mention-menu");
    await page.clickText("smoke-reference.md");
    await page.waitFor(() => document.querySelector('textarea[data-local-agent-composer="true"]')?.value.includes('@smoke-reference.md'), 10000);
    await page.setFiles(uploadPath);
    await page.assertVisibleTestId("local-agent-attachment");

    const prompts = ["第一轮 ACP UI smoke", "第二轮 **Markdown** smoke", "第三轮 artifact smoke https://example.com/report.md"];
    for (let index = 0; index < prompts.length; index += 1) {
      await page.fillTextarea(index === 0 ? `@smoke-reference.md ${prompts[index]}` : prompts[index]);
      await page.clickSend();
      await page.waitForText(`ACP reply ${index + 1}`, 15000);
    }
    await page.waitFor(
      () => document.querySelectorAll('[data-testid="local-agent-turn-status"]').length >= 3,
      10000,
    );
    const collapsedProcess = await page.evaluate(`(() => {
      const triggers = Array.from(document.querySelectorAll('[data-testid="local-agent-turn-status"]'));
      const text = triggers.map((node) => (node.textContent || '').trim());
      return {
        triggerCount: triggers.length,
        labelsUseThoughtDuration: text.every((label) => /^(思考了 |Thought for )/.test(label)),
        hasExpandedTrigger: triggers.some((node) => node.getAttribute('aria-expanded') === 'true'),
        timelineCount: document.querySelectorAll('[data-testid="local-agent-timeline-body"]').length,
        processTextVisible: ['Reasoning smoke', 'fake_search', 'fake_read', 'Intermediate checkpoint 1'].some((needle) => (document.body.innerText || '').includes(needle)),
      };
    })()`);
    assert.ok(collapsedProcess.triggerCount >= 3, "each completed smoke turn should expose a thought-duration trigger");
    assert.equal(collapsedProcess.labelsUseThoughtDuration, true, "completed fold labels should say Thought for / 思考了, not Completed / 已完成");
    assert.equal(collapsedProcess.hasExpandedTrigger, false, "completed process folds should start collapsed");
    assert.equal(collapsedProcess.timelineCount, 0, "collapsed process steps should be absent from the DOM");
    assert.equal(collapsedProcess.processTextVisible, false, "thinking, tools, and narration should not leak before expansion");
    await screenshot(page, "studio-process-collapsed.png");
    await page.clickText(["思考了", "Thought for"]);
    await page.assertVisibleTestId("local-agent-timeline-body");
    await page.waitForText("fake_search", 10000);
    await page.waitForText("fake_read", 10000);
    await page.waitForText("Intermediate checkpoint 1", 10000);
    const chronologicalProcessKinds = await page.evaluate(`(() => {
      const bodies = Array.from(document.querySelectorAll('[data-testid="local-agent-timeline-body"]'));
      const body = bodies.find((node) => node.textContent?.includes('Intermediate checkpoint 1'));
      if (!body) return null;
      return Array.from(body.children).map((node) => node.getAttribute('data-local-agent-process-kind'));
    })()`);
    assert.deepEqual(
      chronologicalProcessKinds,
      ["plan", "thinking", "tool", "text", "tool"],
      "expanded process should preserve plan/thinking/tool/narration/tool chronology",
    );
    const processChrome = await page.evaluate(`(() => {
      const body = Array.from(document.querySelectorAll('[data-testid="local-agent-timeline-body"]'))
        .find((node) => node.textContent?.includes('Intermediate checkpoint 1'));
      if (!body) return null;
      const toolRows = Array.from(body.querySelectorAll('[data-testid="local-agent-reference-tool-row"]'));
      return {
        toolRows: toolRows.length,
        oldToolRows: body.querySelectorAll('[data-testid="conversation-tool-item-row"]').length,
        completedStatusPills: toolRows.filter((row) => row.querySelector('[data-slot="status-badge"]')).length,
        narrationRows: body.querySelectorAll('[data-testid="local-agent-process-narration"]').length,
        taskLists: body.querySelectorAll('.session-workbuddy-task-list').length,
        thinkingFolds: body.querySelectorAll('.session-workbuddy-process-fold.is-thinking').length,
      };
    })()`);
    assert.ok(processChrome?.toolRows >= 2, "tools should render as Expert/Assistant-style borderless rows");
    assert.equal(processChrome.oldToolRows, 0, "old shared rounded tool rows should be absent");
    assert.equal(processChrome.completedStatusPills, 0, "completed tools should not show success pills");
    assert.ok(processChrome.narrationRows >= 1, "intermediate narration should be a plain transcript body");
    assert.ok(processChrome.taskLists >= 1, "plan should use the Expert/Assistant task-list grammar");
    assert.ok(processChrome.thinkingFolds >= 1, "thinking should use the Expert/Assistant process-fold grammar");
    await page.clickText(["任务列表", "任務列表", "Task list"]);
    await page.waitForText("Inspect workspace", 10000);
    await page.waitForText("Content-only plan item", 10000);
    await page.assertVisibleTestId("local-agent-plan-fold-body");
    await page.assertVisibleTestId("conversation-thinking-block");
    await page.assertVisibleTestId("conversation-thinking-header");
    try {
      await page.assertVisibleTestId("conversation-thinking-body");
    } catch {
      await page.clickTestId("conversation-thinking-header");
      await page.assertVisibleTestId("conversation-thinking-body");
    }
    await page.waitForText("Reasoning smoke", 10000);
    await page.clickText("fake_search");
    await page.waitForText(["请求", "請求", "Request"], 10000);
    await page.waitForText(["工具结果", "工具結果", "Tool result"], 10000);
    await page.waitForText("result line 1", 10000);
    await screenshot(page, "studio-process-expanded.png");
    await page.evaluate(`(() => {
      document.documentElement.classList.add('dark');
      document.documentElement.dataset.theme = 'dark';
      return true;
    })()`);
    await page.waitFor(() => document.documentElement.classList.contains('dark'), 10000);
    await screenshot(page, "studio-process-expanded-dark.png");
    await page.evaluate(`(() => {
      document.documentElement.classList.remove('dark');
      document.documentElement.dataset.theme = 'light';
      return true;
    })()`);
    await page.waitForText("Provider timeout", 10000);
    await page.waitFor(() => Array.from(document.querySelectorAll('button')).some((button) => button.getAttribute('aria-label')?.includes('10 / 100')), 10000);
    await page.clickTestId("local-agent-tips-resolution");
    assert.equal(await page.evaluate(`(() => {
      const trigger = Array.from(document.querySelectorAll('[data-testid="local-agent-turn-status"]')).find((node) => node.getAttribute('aria-expanded') === 'true');
      if (!trigger) return false;
      trigger.click();
      return true;
    })()`), true, "expanded thought-duration trigger should be collapsible");
    await page.waitFor(() => document.querySelectorAll('[data-testid="local-agent-timeline-body"]').length === 0, 10000);
    await page.waitForText(["Skill / 来源", "Skill / Source"], 10000);
    await page.clickAria(["设置", "Settings"]);
    await page.waitForText(["Agent 对话", "Agent chat", "本地 Agent", "Local Agent"], 10000);
    await page.clickText(["Agent 对话", "Agent chat", "本地 Agent", "Local Agent"]);
    await page.assertVisibleTestId("local-agent-status-rail");
    await page.waitForText("acp-smoke-1.md", 10000);
    assert.equal(
      await page.evaluate(`document.querySelectorAll('[data-testid="local-agent-timeline-body"]').length`),
      0,
      "returning to Local Agent should preserve the completed process as collapsed",
    );
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

    // Browser-level cadence proof: sample the actual React DOM on animation
    // frames while runtime deltas arrive. The pure benchmark covers publisher
    // and reconciliation cost; this catches rendering that would still feel
    // bursty in the product window.
    await page.evaluate(`(() => {
      const state = { active: true, lastCount: 0, samples: [], terminalVisibleAt: null };
      window.__LOCAL_AGENT_DOM_CADENCE__ = state;
      const sample = () => {
        const text = document.body?.innerText || '';
        const count = Math.min(24, (text.match(/\\[cadence-\\d+\\]/g) || []).length);
        if (count > state.lastCount) {
          state.lastCount = count;
          state.samples.push({ count, at: performance.now() });
        }
        if (state.terminalVisibleAt === null && text.includes('CADENCE_STREAM_DONE')) {
          state.terminalVisibleAt = performance.now();
        }
        if (state.active) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    })()`);
    await page.fillTextarea("cadence stream smoke");
    await page.clickSend();
    await page.waitForText("CADENCE_STREAM_DONE", 15000);
    await page.waitFor(() => window.__LOCAL_AGENT_DOM_CADENCE__?.terminalVisibleAt !== null, 5000);
    const cadence = await page.evaluate(`(() => {
      const dom = window.__LOCAL_AGENT_DOM_CADENCE__;
      const source = window.__LOCAL_AGENT_ACP_SMOKE__?.cadence;
      dom.active = false;
      const gaps = dom.samples.slice(1).map((sample, index) => sample.at - dom.samples[index].at);
      const sorted = [...gaps].sort((left, right) => left - right);
      const p95 = sorted.length ? sorted[Math.floor((sorted.length - 1) * 0.95)] : 0;
      const deliveryLatencies = dom.samples.map((sample) => {
        const emittedAt = source?.emittedAt?.[Math.max(0, sample.count - 1)];
        return typeof emittedAt === 'number' ? sample.at - emittedAt : 0;
      });
      return {
        sourceEvents: source?.emittedAt?.length || 0,
        visibleUpdates: dom.samples.length,
        firstVisibleMs: dom.samples.length && typeof source?.sourceAt === 'number' ? dom.samples[0].at - source.sourceAt : Number.POSITIVE_INFINITY,
        gapP95Ms: p95,
        gapMaxMs: gaps.length ? Math.max(...gaps) : 0,
        deliveredToVisibleMaxMs: deliveryLatencies.length ? Math.max(...deliveryLatencies) : Number.POSITIVE_INFINITY,
        terminalSettleMs: typeof dom.terminalVisibleAt === 'number' && typeof source?.terminalSourceAt === 'number' ? dom.terminalVisibleAt - source.terminalSourceAt : Number.POSITIVE_INFINITY,
        samples: dom.samples,
      };
    })()`);
    assert.equal(cadence.sourceEvents, 24, "browser cadence fixture should emit 24 source deltas");
    assert.ok(cadence.visibleUpdates >= 18, `stream should produce continuous DOM updates, received ${cadence.visibleUpdates}`);
    assert.ok(cadence.firstVisibleMs <= 120, `first visible delta ${cadence.firstVisibleMs}ms exceeds 120ms`);
    assert.ok(cadence.gapP95Ms <= 150, `DOM cadence p95 ${cadence.gapP95Ms}ms exceeds 150ms`);
    assert.ok(cadence.gapMaxMs <= 250, `DOM cadence max ${cadence.gapMaxMs}ms exceeds 250ms`);
    assert.ok(cadence.deliveredToVisibleMaxMs <= 120, `delta-to-DOM max ${cadence.deliveredToVisibleMaxMs}ms exceeds 120ms`);
    assert.ok(cadence.terminalSettleMs <= 250, `DOM terminal settle ${cadence.terminalSettleMs}ms exceeds 250ms`);

    await page.fillTextarea("approval smoke");
    await page.clickSend();
    await page.waitForText("需要你审批后继续", 15000);
    await page.waitForText(["本次会话允许", "Allow for session"], 10000);
    await page.waitForText(["允许一次", "Allow once"], 10000);
    await screenshot(page, "studio-running.png");
    const approvalOverflow = await page.evaluate(`(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid="local-agent-approval-card"]'));
      const results = cards.map((card) => {
        const rect = card.getBoundingClientRect();
        const childOverflow = Array.from(card.querySelectorAll('*')).some((node) => {
          const child = node.getBoundingClientRect();
          if (child.width === 0 && child.height === 0) return false;
          return child.right > rect.right + 1.5 || child.left < rect.left - 1.5;
        });
        return {
          scrollWidth: card.scrollWidth,
          clientWidth: card.clientWidth,
          overflow: childOverflow || card.scrollWidth > card.clientWidth + 1,
        };
      });
      return { count: cards.length, overflow: results.some((item) => item.overflow), results };
    })()`);
    assert.equal(approvalOverflow.count, 1, "pending approval should render a single card");
    assert.equal(approvalOverflow.overflow, false, "approval card children must stay inside the card: " + JSON.stringify(approvalOverflow.results));
    await page.clickText(["允许一次", "Allow once"]);
    await page.waitForText("ACP approved reply", 15000);

    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.turn`), 5, "mock ACP bridge should receive five sends");
    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.setConfigOption`), true, "config/set should be triggered from UI");
    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.warmedConversation`), true, "conversation warmup should be triggered from UI");
    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.configSets?.some((item) => item.optionId === 'model' && item.value === 'ark-coding-openai/ark-code-fast')`), true, "model selector should update agent config state");
    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.configSets?.some((item) => item.optionId === 'model' && item.sessionId === 'acp-session-warm' && item.providerSessionId === 'acp-session-warm')`), true, "model selector should target the selected conversation provider session after warmup");
    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.sentInputs?.some((item) => String(item.prompt).includes('[Referenced files]') && String(item.prompt).includes('smoke-reference.md') && String(item.prompt).includes('[Attached files]') && String(item.prompt).includes('smoke-upload.txt'))`), true, "mention and attachment metadata should reach the real submit path");
    assert.equal(await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.savedAttachment`), true, "browser upload should be persisted through the desktop attachment bridge");
    await page.clickText(["文件", "Files"]);
    await page.waitForText("工作区", 10000).catch(() => undefined);
    await page.clickAria(["设置", "Settings"]);
    await page.waitForText(["Agent 对话", "Agent chat", "本地 Agent", "Local Agent"], 10000);
    await page.clickText(["Agent 对话", "Agent chat", "本地 Agent", "Local Agent"]);
    await page.waitForText("ACP approved reply", 10000);
    await screenshot(page, "04-tab-switch-preserved.png");

    const bodyText = await page.evaluate(`document.body.innerText`);
    for (const forbidden of ["Codex app-server session", "Claude Code stream-json session", "OpenClaw local agent JSON session", "OpenCode SDK session"]) {
      assert.equal(String(bodyText).includes(forbidden), false, `old non-ACP label should be absent: ${forbidden}`);
    }
    for (let turnIndex = 1; turnIndex <= 3; turnIndex += 1) {
      assert.equal(String(bodyText).split(`ACP reply ${turnIndex}:`).length - 1, 1, `turn ${turnIndex} streamed text should settle into one final body without duplication`);
    }
    assert.ok(String(bodyText).includes("ACP approved reply"), "approved ACP reply should remain visible after tab switch");

    const report = { tempRoot, appBaseUrl, workspaceRoot, prompts, collapsedProcess, chronologicalProcessKinds, processChrome, cadence, calls: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.calls || []`), configSets: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.configSets || []`), processPolls: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.processPolls`), hostStatusPolls: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.hostStatusPolls`), sentInputs: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.sentInputs || []`), savedAttachment: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.savedAttachment`), setConfigOption: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.setConfigOption`), warmedConversation: await page.evaluate(`window.__LOCAL_AGENT_ACP_SMOKE__?.warmedConversation`), textLength: String(bodyText).length };
    await writeFile(join(evidenceRoot, "result.json"), JSON.stringify(report, null, 2));
    await writeFile(join(evidenceRoot, "command-output.txt"), [
      "pnpm task test personal-local-agent-acp-ui-smoke",
      "status: PASS",
      `workspaceRoot: ${workspaceRoot}`,
      `browser cadence: first=${cadence.firstVisibleMs.toFixed(2)}ms p95=${cadence.gapP95Ms.toFixed(2)}ms max=${cadence.gapMaxMs.toFixed(2)}ms terminal=${cadence.terminalSettleMs.toFixed(2)}ms updates=${cadence.visibleUpdates}/24`,
      "checks: Thought for / 思考了 duration fold collapsed by default, click-to-expand chronology, Expert/Assistant process chrome parity, light/dark expanded screenshots, click-to-collapse, OpenCode/Codex/Claude ACP labels, background process registry restore, status rail, session-scoped model switch, mention/upload submit, 3-turn history, actual DOM streaming cadence, markdown render, approval card, tab switch preservation, old-label absence",
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

function desktopBridgeMockSource(workspaceRoot, serverBaseUrl, serverToken, serverHostToken) {
  return `(() => {
    const workspaceRoot = ${JSON.stringify(workspaceRoot)};
    const serverBaseUrl = ${JSON.stringify(serverBaseUrl)};
    const serverToken = ${JSON.stringify(serverToken)};
    const serverHostToken = ${JSON.stringify(serverHostToken)};
    let turn = 0;
    const runs = new Map();
    const persistedEvents = [];
    const persistedMessages = [];
    const runtimeEventListeners = new Set();
    const emitRuntimeEvent = (event) => {
      for (const listener of runtimeEventListeners) {
        try { listener(event); } catch {}
      }
    };
    const conversations = [{ id: 'conv-acp-smoke', title: 'ACP Smoke', providerSessionId: 'acp-session-1', resumeKey: 'acp-session-1', workdir: workspaceRoot, createdAt: Date.now(), updatedAt: Date.now(), lastRunId: null, lastStatus: null, source: 'studio-created' }];
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
    const browserStateListeners = new Set();
    const browserPanelListeners = new Set();
    let browserState = { url: '', title: '', canGoBack: false, canGoForward: false, isLoading: false, activeTabId: null, tabs: [] };
    window.__LOCAL_AGENT_ACP_SMOKE__ = {
      runs, calls: [], configSets: [], sentInputs: [], processPolls: 0, hostStatusPolls: 0,
      savedAttachment: false, setConfigOption: false, warmedConversation: false, cadence: null,
      createdCustomAgent: false, updatedCustomAgent: false, deletedCustomAgent: false, browserShowCalls: 0,
      get browserPanelListenerCount() { return browserPanelListeners.size; },
      get browserStateListenerCount() { return browserStateListeners.size; },
      emitBrowserAgentTab() {
        const tab = {
          tabId: 'browser-mcp-tab', owner: 'agent',
          sessionId: 'localAgent:ws_local_agent_acp_smoke:conv-acp-smoke',
          temporary: true, url: 'https://browser-mcp-smoke.example/research',
          title: 'Browser MCP research', canGoBack: false, canGoForward: false,
          isLoading: false, isActive: true,
        };
        browserState = { ...browserState, url: tab.url, title: tab.title, activeTabId: tab.tabId, tabs: [tab] };
        for (const listener of browserStateListeners) listener(browserState);
      },
      markBrowserAgentTabForHandoff() {
        const tab = { ...browserState.tabs[0], deliverable: true, handoff: true };
        browserState = { ...browserState, activeTabId: tab.tabId, tabs: [tab] };
        for (const listener of browserPanelListeners) listener();
        for (const listener of browserStateListeners) listener(browserState);
      },
      get turn() { return turn; },
    };
    const workspaceList = {
      selectedId: 'ws_local_agent_acp_smoke',
      watchedId: 'ws_local_agent_acp_smoke',
      activeId: 'ws_local_agent_acp_smoke',
      workspaces: [{
        id: 'ws_local_agent_acp_smoke',
        name: 'ACP Smoke Workspace',
        path: workspaceRoot,
        preset: 'starter',
        workspaceType: 'local',
        displayName: 'ACP Smoke Workspace',
      }],
    };
    const invokeDesktop = async (command, ...args) => {
      window.__LOCAL_AGENT_ACP_SMOKE__.calls.push(command);
      if (command === 'workspaceBootstrap' || command === 'workspaceList') return workspaceList;
      if (command === 'engineInfo') return { name: 'opencode', version: 'smoke', running: true, baseUrl: serverBaseUrl };
      if (command === 'onmyagentServerInfo') return { running: true, pid: 4241, port: Number(new URL(serverBaseUrl).port), baseUrl: serverBaseUrl, ownerToken: serverToken, hostToken: serverHostToken };
      if (command === 'runtimeBootstrap') return { ok: true, skipped: true };
      if (command === 'userAgentRegistryRead') return { agents: [] };
      if (command === 'agentManagementSnapshot') {
        const input = args[0] || {};
        return {
          generatedAt: Date.now(),
          workspaceRoot,
          agents: [],
          skills: [],
          providers: { databasePath: '', total: 0, byAgent: { opencode: [], codex: [], claude: [], openclaw: [], hermes: [] } },
          loadedDomains: input.domains || ['core', 'skills', 'providers'],
        };
      }
      if (command === 'personalLocalAgentAcpAgentsList' || command === 'personalLocalAgentAcpAgentsRefresh' || command === 'personalLocalAgentMetadataList') return { agents: metadata };
      if (command === 'personalLocalAgentsList') return { agents, metadata };
      if (command === 'personalLocalAgentValidate') return agents.find((item) => item.provider === ((args[0] || {}).provider || (args[0] || {}).agent?.provider)) || agents[0];
      if (command === 'personalLocalAgentConversationsList') return { conversations, activeConversationId: conversations[0].id };
      if (command === 'personalLocalAgentConversationsListByProvider') return { conversations, activeConversationId: conversations[0]?.id || null };
      if (command === 'personalLocalAgentChannelConversationsList') return { conversations: [] };
      if (command === 'personalLocalAgentConversationCreate') return { conversation: conversations[0] };
      if (command === 'personalLocalAgentConversationWarmup') {
        window.__LOCAL_AGENT_ACP_SMOKE__.warmedConversation = true;
        conversations[0] = { ...conversations[0], providerSessionId: 'acp-session-warm', resumeKey: 'acp-session-warm' };
        return { ok: true, conversation: conversations[0], providerSessionId: 'acp-session-warm', resumeKey: 'acp-session-warm' };
      }
      if (command === 'personalLocalAgentConversationTranscript') return { messages: [] };
      if (command === 'personalLocalAgentNativeSessionsList') return { sessions: [] };
      if (command === 'localAgentComposerListFiles') return { files: [{ path: workspaceRoot + '/smoke-reference.md', relativePath: 'smoke-reference.md', name: 'smoke-reference.md', isDirectory: false }] };
      if (command === 'localAgentComposerSaveAttachment') {
        const input = args[0] || {};
        window.__LOCAL_AGENT_ACP_SMOKE__.savedAttachment = true;
        return { path: workspaceRoot + '/.attachments/' + input.name, relativePath: input.name, name: input.name, size: input.size || 0 };
      }
      if (command === 'personalLocalAgentHostStatus') {
        window.__LOCAL_AGENT_ACP_SMOKE__.hostStatusPolls += 1;
        const input = args[0] || {};
        return {
          workspaceRoot,
          agentId: input.agent?.id || null,
          conversationId: input.conversationId || null,
          skill: { skills: [{ id: 'workspace:smoke-skill', name: 'Smoke Skill', indexFile: workspaceRoot + '/.agents/skills/smoke/SKILL.md', source: 'workspace', provenance: 'workspace' }], roots: [{ path: workspaceRoot + '/.agents/skills', exists: true, count: 1 }], error: null },
          mcp: { servers: [{ name: 'smoke-mcp', transport: 'stdio', connected: true, toolCount: 2, source: 'workspace' }], error: null, sourceErrors: [] },
          permission: { pending: 0, approved: 1, denied: 0, remembered: 1, items: [] },
        };
      }
      if (command === 'personalLocalAgentSetAcpConfigOption') {
        window.__LOCAL_AGENT_ACP_SMOKE__.setConfigOption = true;
        const input = args[0] || {};
        window.__LOCAL_AGENT_ACP_SMOKE__.configSets.push({ optionId: input.optionId, value: input.value, sessionId: input.sessionId || null, providerSessionId: input.providerSessionId || null, resumeKey: input.resumeKey || null });
        return { ok: true, sessionId: input.sessionId || 'acp-session-1', optionId: input.optionId, value: input.value, confirmation: 'Mode updated', configOptions: [{ id: 'mode', label: 'Mode', type: 'select', value: input.value, options: ['default', 'plan'] }] };
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
        window.__LOCAL_AGENT_ACP_SMOKE__.sentInputs.push(input);
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
        if (String(input.prompt || '').includes('cadence stream smoke')) {
          run.eventRevision = 0;
          const chunks = [];
          const cadence = { runId: run.runId, sourceAt: null, terminalSourceAt: null, emittedAt: [] };
          window.__LOCAL_AGENT_ACP_SMOKE__.cadence = cadence;
          setTimeout(() => {
            let index = 0;
            const timer = setInterval(() => {
              index += 1;
              const text = '[cadence-' + String(index).padStart(2, '0') + ']';
              const event = { eventId: run.runId + ':' + index, type: 'assistant_chunk', text, at: Date.now() };
              const emittedAt = performance.now();
              if (cadence.sourceAt === null) cadence.sourceAt = emittedAt;
              cadence.emittedAt.push(emittedAt);
              chunks.push(text);
              run.events.push(event);
              run.eventRevision = index;
              run.conversationMessages = [{ id: 'cadence-live', type: 'text', role: 'assistant', text: chunks.join(''), createdAt: now, sourceEventType: 'assistant_chunk' }];
              runs.set(run.runId, run);
              emitRuntimeEvent({
                type: 'run.delta', runId: run.runId, workspaceRoot, conversationId: run.conversationId,
                status: 'running', updatedAt: Date.now(), revision: index, revisionStart: index, events: [event],
              });
              if (index !== 24) return;
              clearInterval(timer);
              setTimeout(() => {
                const finalText = chunks.join('') + ' CADENCE_STREAM_DONE';
                const revision = index + 1;
                const finalEvent = { eventId: run.runId + ':' + revision, type: 'assistant', text: finalText, at: Date.now() };
                const done = {
                  ...run, ok: true, status: 'completed', finishedAt: Date.now(), output: finalText,
                  events: [...run.events, finalEvent], eventRevision: revision,
                  conversationMessages: [
                    { id: 'cadence-live', type: 'text', role: 'assistant', text: chunks.join(''), createdAt: now, sourceEventType: 'assistant_chunk' },
                    { id: 'cadence-finish', type: 'finish', role: 'assistant', text: finalText, createdAt: Date.now(), sourceEventType: 'assistant' },
                  ],
                };
                runs.set(run.runId, done);
                cadence.terminalSourceAt = performance.now();
                emitRuntimeEvent({
                  type: 'run.finished', runId: run.runId, workspaceRoot, conversationId: run.conversationId,
                  status: 'completed', updatedAt: Date.now(), revision, revisionStart: revision, events: [finalEvent],
                });
              }, 40);
            }, 40);
          }, 120);
          return run;
        }
        if (String(input.prompt || '').includes('approval')) {
          run.pendingApprovals = [{ id: 'approval-' + turn, runId: run.runId, provider: 'opencode', method: 'session/request_permission', kind: 'command', title: 'ACP permission request', summary: 'Run harmless command', command: 'python3 /Users/huangchunan/Library/ApplicationSupport/OnMyAgent/workspaces/very-long-workspace-name/scripts/deploy.py --config=/Users/huangchunan/Library/ApplicationSupport/OnMyAgent/workspaces/very-long-workspace-name/config/production.generated.json --token=abcdefghijklmnopqrstuvwxyz0123456789', cwd: workspaceRoot + '/apps/app/src/react-app/domains/local-agents/messages', readonly: false, params: {}, createdAt: now }];
          run.events.push({ type: 'approval_request', text: 'Run harmless command', at: now, approval: run.pendingApprovals[0] });
          runs.set(run.runId, run);
          return run;
        }
        const text = 'ACP reply ' + turn + ': **Markdown** ok\\n\\nartifact: reports/acp-smoke-' + turn + '.md\\nhttps://example.com/report.md';
        const userEvent = { eventId: 'user-event-' + turn, type: 'user', text: input.prompt, at: now };
        const userMessage = { id: 'user-message-' + turn, type: 'text', role: 'user', text: input.prompt, createdAt: now };
        const toolCall = { id: 'fake-search-' + turn, name: 'fake_search', status: 'completed', description: 'query local agent smoke', input: '{"query":"local agent smoke"}', output: ['result line 1', 'result line 2'].join('\\n') };
        const secondToolCall = { id: 'fake-read-' + turn, name: 'fake_read', status: 'completed', description: 'reports/acp-smoke-' + turn + '.md', input: '{"path":"reports/acp-smoke-' + turn + '.md"}', output: '# ACP smoke ' + turn };
        const processEvents = [
          { type: 'plan', text: 'Inspect workspace', at: Date.now(), plan: { entries: [{ id: 'p1', title: 'Inspect workspace', status: 'completed', priority: 'high' }, { id: 'p2', content: 'Content-only plan item', status: 'pending' }] } },
          { type: 'thinking', text: 'Reasoning smoke', at: Date.now(), status: 'thinking', msgId: 'msg-' + turn, startedAt: now, durationMs: 400 },
          { type: 'thinking', text: '', at: Date.now(), status: 'done', msgId: 'msg-' + turn, startedAt: now, durationMs: 800 },
          { type: 'tool', text: 'tool_call> fake_search', at: Date.now(), toolCall },
          { type: 'assistant_chunk', text: 'Intermediate checkpoint ' + turn, at: Date.now() },
          { type: 'tool', text: 'tool_call> fake_read', at: Date.now(), toolCall: secondToolCall },
          { type: 'assistant_chunk', text: 'ACP reply ' + turn + ': ', at: Date.now() },
          { type: 'assistant_chunk', text: '**Markdown** ok', at: Date.now() },
          { type: 'tips', text: 'Provider timeout', at: Date.now(), category: 'error', ownership: 'provider', resolution: { target: 'provider', kind: 'retry', message: 'Retry later' } },
          { type: 'status', text: 'acp_context_usage> {"used":10,"total":100}', at: Date.now() },
        ];
        const running = { ...run, events: [userEvent, ...run.events], conversationMessages: [userMessage] };
        const done = finish({ ...run, events: [userEvent, ...run.events, ...processEvents] }, text);
        done.finishedAt = now + 12_000;
        done.events[done.events.length - 1] = { ...done.events.at(-1), at: done.finishedAt };
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
        persistedEvents.push(userEvent);
        persistedMessages.push(userMessage);
        runs.set(run.runId, running);
        setTimeout(() => {
          persistedEvents.push(...done.events.slice(1));
          persistedMessages.push(...done.conversationMessages);
          const finalEvent = done.events.at(-1);
          runs.set(run.runId, {
            ...done,
            events: [userEvent, finalEvent],
            conversationMessages: [userMessage, done.conversationMessages.at(-1)],
          });
          emitRuntimeEvent({
            type: 'run.finished', runId: run.runId, workspaceRoot, conversationId: run.conversationId,
            status: 'completed', updatedAt: done.finishedAt, events: [finalEvent],
          });
        }, 80);
        return running;
      }
      if (command === 'personalLocalAgentStatus') return runs.get((args[0] || {}).runId || args[0]) || null;
      if (command === 'personalLocalAgentConversationStatus') {
        const activeRun = Array.from(runs.values()).find((candidate) =>
          candidate.conversationId === conversations[0]?.id && candidate.status === 'running'
        ) || null;
        return {
          conversation: conversations[0] || null,
          activeRun,
          running: Boolean(activeRun),
          status: activeRun ? 'running' : (persistedMessages.length ? 'completed' : 'idle'),
          events: [...persistedEvents],
          conversationMessages: [...persistedMessages],
        };
      }
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
        const backgroundAgents = [
          { id: 'opencode', name: 'OpenCode', pid: 42420, command: 'opencode acp', conversationId: 'conv-background-opencode' },
          { id: 'codex', name: 'Codex', pid: 42421, command: 'codex-acp', conversationId: 'conv-background-codex' },
          { id: 'claude', name: 'Claude Code', pid: 42422, command: 'claude-agent-acp', conversationId: 'conv-background-claude' },
        ];
        const now = Date.now();
        for (const agent of backgroundAgents) {
          const runId = 'run-background-' + agent.id;
          if (runs.has(runId)) continue;
          runs.set(runId, {
            ok: false, runId, agentId: agent.id, agentProvider: agent.id,
            connectionMode: agent.name + ' ACP session', status: 'running', startedAt: now - 3000, finishedAt: null,
            pid: agent.pid, command: agent.command, output: '', error: null,
            events: [{ type: 'status', text: 'background smoke run', at: now - 3000 }], logPath: null,
            conversationId: agent.conversationId, providerSessionId: null, resumeKey: null,
            metadata: { agent_type: 'acp' }, workdir: workspaceRoot, debugSummary: 'background smoke', errorInfo: null,
            approvalMode: 'ask', pendingApprovals: [], artifacts: []
          });
        }
        return {
          processes: backgroundAgents.map((agent) => ({
            runId: 'run-background-' + agent.id, pid: agent.pid, provider: agent.id, backend: agent.id,
            conversationId: agent.conversationId, agentType: 'acp', command: agent.command,
            startedAt: now - 3000, updatedAt: now,
          })),
        };
      }
      return null;
    };
    window.__ONMYAGENT_ELECTRON__ = {
      invokeDesktop,
      personalAgentRuntime: {
        onEvent(listener) {
          runtimeEventListeners.add(listener);
          return () => runtimeEventListeners.delete(listener);
        },
      },
      shell: { openExternal: async () => undefined },
      browser: {
        createTab: async () => ({ tabId: 'tab' }),
        navigate: async () => undefined,
        show: async () => { window.__LOCAL_AGENT_ACP_SMOKE__.browserShowCalls += 1; },
        hide: async () => undefined,
        setBounds: async () => undefined,
        selectTab: async () => undefined,
        getState: async () => browserState,
        onStateChange(listener) {
          browserStateListeners.add(listener);
          return () => browserStateListeners.delete(listener);
        },
        onPanelOpened(listener) {
          browserPanelListeners.add(listener);
          return () => browserPanelListeners.delete(listener);
        },
      },
    };
  })();`;
}
