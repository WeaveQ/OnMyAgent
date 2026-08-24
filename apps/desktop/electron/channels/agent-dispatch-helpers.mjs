import { createHash } from "node:crypto";

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function safeId(value, keep = 8) {
  const raw = String(value ?? "").trim();
  if (!raw) return "?";
  return raw.length <= keep ? raw : raw.slice(0, keep);
}

export function getChannelRunSnapshotState(snapshot) {
  const status = String(snapshot?.status ?? "");
  const pendingApprovals = Array.isArray(snapshot?.pendingApprovals) ? snapshot.pendingApprovals : [];
  return {
    status,
    pendingApprovals,
    hasPendingApprovals: pendingApprovals.length > 0,
    isCompletedWithOutput: status === "completed" && Boolean(snapshot?.output),
    isRunning: !status || status === "running",
    isTerminal: Boolean(status && status !== "running"),
  };
}

export function splitTextForPlatform(text, maxLength = 2000) {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const limit = Number.isFinite(Number(maxLength)) ? Math.max(2, Math.floor(Number(maxLength))) : 2000;
  if (raw.length <= limit) return [raw];
  const chunks = [];
  let rest = raw;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf("。", limit);
    if (cut < limit * 0.5) cut = limit;
    if (
      cut > 0
      && cut < rest.length
      && rest.charCodeAt(cut - 1) >= 0xD800
      && rest.charCodeAt(cut - 1) <= 0xDBFF
      && rest.charCodeAt(cut) >= 0xDC00
      && rest.charCodeAt(cut) <= 0xDFFF
    ) {
      cut -= 1;
    }
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks.filter(Boolean);
}

export function normalizePromptMode(value) {
  const mode = String(value ?? "raw").trim().toLowerCase();
  return mode === "debug" ? "debug" : "raw";
}

export function parseAgentSwitchCommand(text) {
  const match = String(text ?? "").trim().match(/^(?:#agent|\/agent|切换agent|切换Agent|切换代理)(?:\s+(.+))?$/i);
  return match ? { target: String(match[1] ?? "").trim() } : null;
}

export function parseModeCommand(text) {
  const match = String(text ?? "").trim().match(/^(?:#mode|\/mode|#prompt|\/prompt|切换模式)(?:\s+(.+))?$/i);
  return match ? { target: String(match[1] ?? "").trim() } : null;
}

export function parseModelSwitchCommand(text) {
  const match = String(text ?? "").trim().match(/^(?:#model|\/model|切换模型)(?:\s+(.+))?$/i);
  return match ? { target: String(match[1] ?? "").trim() } : null;
}

export function parseRunCommand(text) {
  const raw = String(text ?? "").trim().toLowerCase();
  if (raw === "#status" || raw === "/status" || raw === "状态") return { name: "status" };
  if (raw === "#runs" || raw === "/runs" || raw === "任务") return { name: "runs" };
  if (raw === "#cancel" || raw === "/cancel" || raw === "取消") return { name: "cancel" };
  if (raw === "#continue" || raw === "/continue" || raw === "继续") return { name: "continue" };
  const newSessionCommands = [
    "#new",
    "/new",
    "#new session",
    "/new session",
    "#reset",
    "/reset",
    "#reset session",
    "/reset session",
    "新会话",
    "重置会话",
  ];
  if (newSessionCommands.includes(raw)) return { name: "new" };
  return null;
}

export function parseApprovalCommand(text) {
  const raw = String(text ?? "").trim().toLowerCase();
  const match = raw.match(
    /^(?:#|\/)?(approve|allow|yes|批准|同意|通过|deny|reject|no|拒绝|不同意)(?:\s+(.+))?$/i,
  );
  if (!match) return null;
  const verb = String(match[1] ?? "").toLowerCase();
  const args = String(match[2] ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const accept = ["approve", "allow", "yes", "批准", "同意", "通过"].includes(verb);
  const session = args.some((arg) => ["session", "always", "本次", "本轮"].includes(arg));
  return {
    decision: accept ? (session ? "acceptForSession" : "accept") : "decline",
    all: args.includes("all") || args.includes("全部"),
  };
}

export function agentLabel(agent) {
  return `${agent.name || agent.id} (${agent.provider}${agent.id && agent.id !== agent.provider ? `/${agent.id}` : ""})`;
}

function agentAliases(agent) {
  return [agent.id, agent.provider, agent.name]
    .map((item) => String(item ?? "").trim().toLowerCase())
    .filter(Boolean);
}

export function resolveAgentAlias(agents, target) {
  const normalized = String(target ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return agents.find((agent) => agentAliases(agent).includes(normalized)) ?? null;
}

function stableHash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 12);
}

function safeSegment(value) {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9_.@-]/g, "_").slice(0, 48) || "default";
}

export function chatAgentHistoryKey(chatId, agent) {
  return `${String(chatId ?? "").trim()}::agent:${agent.provider}/${agent.id}`;
}

export function activeRunKey(chatId, agent) {
  return `${String(chatId ?? "").trim()}::agent:${agent.provider}/${agent.id}`;
}

export function activeRunGuardKey(accountId, runKey) {
  return `${String(accountId ?? "").trim()}:${String(runKey ?? "").trim()}`;
}

export function scopedRuntimeAgent(platformType, platformName, agent, event) {
  const scopeHash = stableHash(`${event.accountId}\n${event.chatId}\n${agent.provider}\n${agent.id}`);
  return {
    ...agent,
    id: `${safeSegment(agent.id)}-${platformType}-${scopeHash}`,
    name: agent.name ? `${agent.name} · ${platformName}` : `${agent.provider} · ${platformName}`,
  };
}

export function renderAgentHelp(session, chatId) {
  const current = session.options.agentByChat.get(chatId) ?? session.options.agent;
  return [
    `当前回复 Agent：${agentLabel(current)}`,
    "可用 Agent：",
    ...session.options.availableAgents.map((agent) => `- ${agent.id}: ${agentLabel(agent)}`),
    "",
    "发送 #agent <id> 切换，例如：#agent codex 或 #agent onmyagent（连接本地助理）",
  ].join("\n");
}

export function renderModeHelp(session, chatId) {
  const current = session.options.promptModeByChat.get(chatId) ?? session.options.promptMode;
  return [
    `当前转发模式：${current}`,
    "可用模式：raw、debug",
    "发送 #mode raw 使用原文直通；发送 #mode debug 使用调试上下文。",
  ].join("\n");
}

export function renderRunStatus(run) {
  const agent = run?.agent ? agentLabel(run.agent) : "unknown";
  const status = String(run?.status ?? "running");
  const runIdValue = safeId(run?.runId, 12);
  const startedAt = run?.startedAt
    ? new Date(run.startedAt).toISOString().replace("T", " ").slice(0, 19)
    : "unknown";
  const approval = Array.isArray(run?.pendingApprovals) && run.pendingApprovals.length
    ? `\n待审批：${run.pendingApprovals.length}`
    : "";
  return [
    `当前任务：${status}`,
    `Agent：${agent}`,
    `runId：${runIdValue}`,
    `开始时间：${startedAt}${approval}`,
  ].join("\n");
}

export function renderApprovalPrompt(run, pendingApprovals) {
  const approvals = Array.isArray(pendingApprovals) ? pendingApprovals : [];
  const first = approvals[0] ?? {};
  return [
    "本地 Agent 请求权限审批。",
    `Agent：${run?.agent ? agentLabel(run.agent) : "unknown"}`,
    `runId：${safeId(run?.runId, 12)}`,
    first.title ? `标题：${first.title}` : null,
    first.summary ? `说明：${first.summary}` : null,
    first.command ? `命令：${first.command}` : null,
    first.cwd ? `目录：${first.cwd}` : null,
    approvals.length > 1 ? `待审批数量：${approvals.length}` : null,
    "",
    "回复 #approve 批准一次；#approve session 批准本轮；#deny 拒绝。",
    approvals.length > 1 ? "可用 #approve all 或 #deny all 处理全部。" : null,
  ].filter(Boolean).join("\n");
}

export function renderRunsList(platformName, runs) {
  const items = Array.isArray(runs) ? runs : [];
  if (!items.length) return `当前账号没有运行中的${platformName}本地 Agent 任务。`;
  return [
    "当前账号运行中的任务：",
    ...items.map((run) => (
      `- ${String(run.chatId ?? "?")} / ${run?.agent?.id ?? "unknown"}: `
      + `${String(run.status ?? "running")} (${safeId(run.runId, 12)})`
    )),
  ].join("\n");
}

export function buildPrompt(platformName, event, options = {}) {
  const mode = normalizePromptMode(options.mode);
  const history = Array.isArray(options.history) ? options.history : [];
  const historyLines = history.length
    ? [
      "",
      "最近对话:",
      ...history.map((item) => (
        `- ${item.role || "unknown"}${item.agentId ? `/${item.agentId}` : ""}: `
        + String(item.text ?? "").trim()
      )),
    ]
    : [];
  const agent = options.agent ?? {};
  return [
    `来源: ${platformName}`,
    `chat_id: ${event.chatId}`,
    `user_id: ${event.senderId}`,
    event.messageId ? `message_id: ${event.messageId}` : null,
    agent.id ? `agent: ${agent.provider || "unknown"}/${agent.id}` : null,
    `prompt_mode: ${mode}`,
    ...historyLines,
    "",
    "用户消息:",
    event.text,
  ].filter((line) => line !== null).join("\n");
}

export async function runAgentTurn(runtime, input) {
  if (typeof runtime.startMessage !== "function" || typeof runtime.getRun !== "function") {
    return await runtime.runMessage(input);
  }
  const started = await runtime.startMessage(input);
  const runId = started?.runId;
  if (!runId) return started;
  const deadline = Date.now() + Math.max(30_000, Number(input.timeoutMs ?? 15 * 60_000));
  while (Date.now() < deadline) {
    const snapshot = await runtime.getRun({ runId, workspaceRoot: input.workspaceRoot });
    const snapshotState = getChannelRunSnapshotState(snapshot);
    if (snapshotState.hasPendingApprovals || snapshotState.isTerminal) return snapshot;
    await sleep(250);
  }
  return await runtime.getRun({ runId, workspaceRoot: input.workspaceRoot });
}
