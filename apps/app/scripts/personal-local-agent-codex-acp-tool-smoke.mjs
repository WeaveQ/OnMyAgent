#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { resolve } from "node:path";

const repoRoot = resolve(new URL("../../..", import.meta.url).pathname);
const evidenceRoot = resolve(repoRoot, ".loop/evidence/personal-agent-codex-acp-stability");
const workspaceRoot = process.env.ONMYAGENT_CODEX_ACP_SMOKE_WORKSPACE || repoRoot;
const cdpPort = Number(process.env.ONMYAGENT_ELECTRON_REMOTE_DEBUG_PORT || 9823);
const timeoutMs = Number(process.env.ONMYAGENT_CODEX_ACP_SMOKE_TIMEOUT_MS || 180000);

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function getJson(url) {
  return new Promise((resolveJson, reject) => {
    http.get(url, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolveJson(JSON.parse(body)));
    }).on("error", reject);
  });
}

async function connectElectronPage() {
  const tabs = await getJson(`http://127.0.0.1:${cdpPort}/json/list`);
  const tab = tabs.find((item) => String(item.url).includes("localhost:5173")) ?? tabs[0];
  assert.ok(tab?.webSocketDebuggerUrl, `Electron CDP tab should be available on port ${cdpPort}`);
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  await send("Runtime.enable");
  return { ws, evaluate };
}

async function createCodexConversation(page, title) {
  const conversation = await page.evaluate(`window.__ONMYAGENT_ELECTRON__.invokeDesktop('personalLocalAgentConversationCreate', ${JSON.stringify({
    workspaceRoot,
    agent: { id: "codex", provider: "codex", name: "Codex CLI", executablePath: "codex" },
    title,
  })})`);
  assert.ok(conversation?.conversation?.id, "Codex ACP smoke should create a fresh Studio conversation");
  assert.equal(conversation.conversation.provider, "codex", "Codex ACP smoke conversation should be scoped to Codex");
  assert.equal(conversation.conversation.providerSessionId, null, "Codex ACP smoke conversation should start without a provider session");
  return conversation.conversation;
}

async function waitForRun(page, started) {
  let current = started;
  const deadline = Date.now() + timeoutMs;
  while (current.status === "running" && Date.now() < deadline) {
    await wait(1000);
    current = await page.evaluate(`window.__ONMYAGENT_ELECTRON__.invokeDesktop('personalLocalAgentStatus', ${JSON.stringify({ runId: current.runId, workspaceRoot })})`);
  }
  return current;
}

async function runCodexPrompt(page, { title, prompt, approvalMode }) {
  const conversation = await createCodexConversation(page, title);
  const input = {
    workspaceRoot,
    conversationId: conversation.id,
    prompt,
    agent: { id: "codex", provider: "codex", name: "Codex CLI", executablePath: "codex" },
    approvalMode,
    model: "gpt-5.5",
  };
  const current = await page.evaluate(`window.__ONMYAGENT_ELECTRON__.invokeDesktop('personalLocalAgentAcpSend', ${JSON.stringify(input)})`);
  assert.ok(current?.runId, "Codex ACP smoke should return a run id");
  return waitForRun(page, current);
}

async function runCodexToolSmoke(page) {
  return runCodexPrompt(page, {
    title: `Codex ACP tool smoke ${Date.now()}`,
    prompt: "请通过 shell 执行 printf CODEX_ACP_TOOL_OK，然后只回复 CODEX_ACP_TOOL_DONE。",
    approvalMode: "auto",
  });
}

async function runCodexNetworkSmoke(page) {
  return runCodexPrompt(page, {
    title: `Codex ACP network smoke ${Date.now()}`,
    prompt: "请通过 shell 执行 curl -I --max-time 5 https://example.com，然后只回复 CODEX_ACP_NETWORK_DONE 和 HTTP 状态；如果 DNS 或网络不可用，回复 CODEX_ACP_NETWORK_REFUSED。",
    approvalMode: "auto",
  });
}

async function main() {
  await mkdir(evidenceRoot, { recursive: true });
  const page = await connectElectronPage();
  try {
    const run = await runCodexToolSmoke(page);
    const networkRun = await runCodexNetworkSmoke(page);
    await writeFile(resolve(evidenceRoot, "codex-tool-smoke.json"), JSON.stringify(run, null, 2));
    await writeFile(resolve(evidenceRoot, "codex-network-smoke.json"), JSON.stringify(networkRun, null, 2));
    const log = run.logPath ? await readFile(run.logPath, "utf8").catch(() => "") : "";
    const networkLog = networkRun.logPath ? await readFile(networkRun.logPath, "utf8").catch(() => "") : "";
    await writeFile(resolve(evidenceRoot, "codex-tool-smoke-log.txt"), log);
    await writeFile(resolve(evidenceRoot, "codex-network-smoke-log.txt"), networkLog);
    const networkHandled = networkRun.status === "completed"
      || Boolean(networkRun.pendingApprovals?.length)
      || ["sandbox_or_network_refusal", "acp_tool_failed", "acp_bridge_interrupted_after_retry"].includes(String(networkRun.errorInfo?.code ?? ""));
    const summary = {
      status: run.status,
      runId: run.runId,
      logPath: run.logPath,
      output: run.output,
      error: run.error,
      errorInfo: run.errorInfo,
      usesManagedCodexAcp: /codex-acp/.test(String(run.command ?? "") + log),
      noSetModelSkipped: !/set_model skipped/i.test(log),
      modelNormalized: /model=gpt-5\.5\[medium\]/.test(String(run.command ?? "") + log),
      noImplicitResume: !/codex ACP session resumed/i.test(log),
      sawToolOutput: /CODEX_ACP_TOOL_OK|CODEX_ACP_TOOL_DONE/.test(JSON.stringify(run) + log),
      classifiedFailure: run.status !== "failed" || Boolean(run.errorInfo?.code),
      networkStatus: networkRun.status,
      networkRunId: networkRun.runId,
      networkLogPath: networkRun.logPath,
      networkOutput: networkRun.output,
      networkErrorInfo: networkRun.errorInfo,
      networkHandled,
    };
    await writeFile(resolve(evidenceRoot, "codex-tool-smoke-summary.json"), JSON.stringify(summary, null, 2));
    assert.equal(summary.usesManagedCodexAcp, true, "Codex run should use managed codex-acp bridge");
    assert.equal(summary.noSetModelSkipped, true, "Codex run log should not contain set_model skipped");
    assert.equal(summary.modelNormalized, true, "Codex run should use modelId[effort] syntax");
    assert.equal(summary.noImplicitResume, true, "Codex fresh conversation should not implicitly resume an old provider session");
    assert.equal(summary.classifiedFailure, true, "Codex failed runs should carry a classified errorInfo.code");
    assert.equal(run.status, "completed", `Codex run should complete: ${run.error ?? ""}`);
    assert.equal(summary.sawToolOutput, true, "Codex tool smoke marker should appear in output or log");
    assert.equal(networkHandled, true, `Codex network/sandbox smoke should complete, ask approval, or fail with classification: ${networkRun.error ?? ""}`);
    console.log("CODEX_ACP_TOOL_SMOKE_OK");
  } finally {
    page.ws.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
