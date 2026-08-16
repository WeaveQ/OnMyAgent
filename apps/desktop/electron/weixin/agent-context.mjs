import { normalizePersonalLocalAgent } from "../personal-agent-runtime/provider-registry.mjs";
import { getChannelRunSnapshotState } from "./local-qr.mjs";
import { normalizePromptMode } from "./chat-policy.mjs";
import { safeId, safeSegment, sleep, stableHash } from "./helpers.mjs";

export async function storeSafeReadChatSetting(session, chatId) {
  try {
    return await session.store.readChatSetting(session.account.accountId, chatId);
  } catch {
    return null;
  }
}

export async function currentAgentForChat(session, chatId) {
  const memoryAgent = session.options.agentByChat.get(chatId);
  if (memoryAgent) return memoryAgent;
  const setting = await storeSafeReadChatSetting(session, chatId);
  const storedAgent = setting?.agent ? normalizePersonalLocalAgent(setting.agent) : null;
  if (storedAgent) {
    const available = resolveAgentAlias(session.options.availableAgents, storedAgent.id) ?? storedAgent;
    session.options.agentByChat.set(chatId, available);
    return available;
  }
  const bindingStore = session.options.channelAssistantBindingStore;
  if (bindingStore) {
    const chatBinding = bindingStore.getChatAssistant("wechat", chatId);
    const platformBinding = chatBinding ?? bindingStore.getPlatformSettings("wechat")?.assistant ?? null;
    const bindingId = platformBinding?.assistant_id;
    if (bindingId) {
      const alias = resolveAgentAlias(session.options.availableAgents, bindingId);
      if (alias) {
        session.options.agentByChat.set(chatId, alias);
        return alias;
      }
    }
  }
  return session.options.agent;
}

export async function currentPromptModeForChat(session, chatId) {
  const memoryMode = session.options.promptModeByChat.get(chatId);
  if (memoryMode) return memoryMode;
  const setting = await storeSafeReadChatSetting(session, chatId);
  const mode = normalizePromptMode(setting?.promptMode ?? session.options.promptMode);
  session.options.promptModeByChat.set(chatId, mode);
  return mode;
}

export async function currentModelForChat(session, chatId) {
  const memory = session.options.modelByChat.get(chatId);
  if (memory !== undefined) return memory;
  const setting = await storeSafeReadChatSetting(session, chatId);
  const stored = typeof setting?.model === "string" ? setting.model.trim() : "";
  session.options.modelByChat.set(chatId, stored);
  return stored;
}

// Returns the per-chat model only if it is actually offered by the current
// agent. When the user switches agents (e.g. from CodeBuddy which accepts
// "auto" to Codex which requires a "modelId[effort]" form), a stale per-chat
// model from the previous agent must not be forwarded — otherwise the runtime
// rejects it (e.g. "Unknown model auto[medium]"). We drop the stale override
// from memory and persisted settings so the agent falls back to its default.
export async function validatedModelForAgent(session, chatId, agent, { store, appendLog }) {
  const model = await currentModelForChat(session, chatId);
  if (!model) return "";
  const options = agentModelOptionsFor(agent);
  if (options.length === 0) {
    // Agent exposes no model list: only forward the per-chat model when the
    // agent itself was configured with this model as its default (so we don't
    // pass an arbitrary string to a provider that can't validate it).
    return agent?.model === model ? model : "";
  }
  const ok = options.some((option) => option.id === model)
    || options.some((option) => option.id.toLowerCase() === model.toLowerCase());
  if (ok) return model;
  // Stale model from a different agent — clear it so we stop failing.
  session.options.modelByChat.set(chatId, "");
  await store.writeChatSetting(session.account.accountId, chatId, { model: "" }).catch(() => undefined);
  appendLog({ type: "debug", text: `weixin: dropped stale per-chat model "${model}" (not in ${agent?.id ?? "unknown"} model list)` });
  return "";
}

export async function enrichAgentModelOptions(runtime, session, agent) {
  if (!agent) return agent;
  const existing = agentModelOptionsFor(agent);
  if (existing.length > 0) return agent;
  if (!runtime || typeof runtime.listAgents !== "function") return agent;
  try {
    const workspaceRoot = session?.options?.workspaceRoot ?? "";
    const accessibleWorkspaceRoots = session?.options?.accessibleWorkspaceRoots ?? [];
    const listed = await runtime.listAgents({ workspaceRoot, accessibleWorkspaceRoots, includeModels: true });
    const list = Array.isArray(listed?.agents) ? listed.agents : [];
    const match = list.find((item) => item?.id === agent.id)
      || list.find((item) => item?.provider === agent.provider);
    if (!match) return agent;
    const options = Array.isArray(match.modelOptions) ? match.modelOptions : [];
    const defaultModel = typeof match.defaultModel === "string" ? match.defaultModel : agent.defaultModel;
    return { ...agent, modelOptions: options, defaultModel };
  } catch {
    return agent;
  }
}

export function agentModelOptionsFor(agent) {
  if (!agent) return [];
  const options = Array.isArray(agent.modelOptions) ? agent.modelOptions : [];
  return options
    .map((option) => {
      if (option && typeof option === "object") {
        const id = String(option.id ?? option.value ?? option.name ?? "").trim();
        if (!id) return null;
        const label = String(option.label ?? option.name ?? id).trim() || id;
        return { id, label };
      }
      const id = String(option ?? "").trim();
      return id ? { id, label: id } : null;
    })
    .filter(Boolean);
}

export function resolveAgentModelId(agent, target) {
  const raw = String(target ?? "").trim();
  if (!raw) return null;
  const options = agentModelOptionsFor(agent);
  const exact = options.find((option) => option.id === raw);
  if (exact) return exact.id;
  const lower = raw.toLowerCase();
  const ci = options.find((option) => option.id.toLowerCase() === lower || option.label.toLowerCase() === lower);
  if (ci) return ci.id;
  return options.length === 0 ? raw : null;
}

export function renderModelHelp(agent, currentModel) {
  const label = agent ? agentLabel(agent) : "unknown";
  const options = agentModelOptionsFor(agent);
  const current = currentModel ? currentModel : (agent?.defaultModel || agent?.model || "");
  const header = current
    ? `当前 ${label} 使用模型：${current}`
    : `当前 ${label} 使用默认模型`;
  if (options.length === 0) {
    return [
      header,
      "该 Agent 未提供可选模型列表。可发送 #model <模型名> 手动切换；发送 #model default 恢复默认。",
    ].join("\n");
  }
  return [
    header,
    "可用模型：",
    ...options.map((option) => `- ${option.id}${option.label && option.label !== option.id ? ` (${option.label})` : ""}`),
    "",
    "发送 #model <id> 切换当前微信会话的模型；发送 #model default 恢复默认。",
  ].join("\n");
}

export function agentLabel(agent) {
  return `${agent.name || agent.id} (${agent.provider}${agent.id && agent.id !== agent.provider ? `/${agent.id}` : ""})`;
}

export function agentAliases(agent) {
  return [agent.id, agent.provider, agent.name]
    .map((item) => String(item ?? "").trim().toLowerCase())
    .filter(Boolean);
}

export function resolveAgentAlias(agents, target) {
  const normalized = String(target ?? "").trim().toLowerCase();
  if (!normalized) return null;
  return agents.find((agent) => agentAliases(agent).includes(normalized)) ?? null;
}

export function scopedWeixinRuntimeAgent(agent, event) {
  const scopeHash = stableHash(`${event.accountId}\n${event.chatId}\n${agent.provider}\n${agent.id}`);
  return {
    ...agent,
    id: `${safeSegment(agent.id)}-weixin-${scopeHash}`,
    name: agent.name ? `${agent.name} · Weixin` : `${agent.provider} · Weixin`,
  };
}

export function renderAgentHelp(session, chatId) {
  const current = session.options.agentByChat.get(chatId) ?? session.options.agent;
  const lines = [
    `当前回复 Agent：${agentLabel(current)}`,
    "可用 Agent：",
    ...session.options.availableAgents.map((agent) => `- ${agent.id}: ${agentLabel(agent)}`),
    "",
    "发送 #agent <id> 切换，例如：#agent codex 或 #agent onmyagent（连接本地助理）",
  ];
  return lines.join("\n");
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
  const startedAt = run?.startedAt ? new Date(run.startedAt).toISOString().replace("T", " ").slice(0, 19) : "unknown";
  const approval = Array.isArray(run?.pendingApprovals) && run.pendingApprovals.length ? `\n待审批：${run.pendingApprovals.length}` : "";
  return [`当前任务：${status}`, `Agent：${agent}`, `runId：${runIdValue}`, `开始时间：${startedAt}${approval}`].join("\n");
}

export function renderApprovalPrompt(run, pendingApprovals) {
  const approvals = Array.isArray(pendingApprovals) ? pendingApprovals : [];
  const first = approvals[0] ?? {};
  const lines = [
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
  ];
  return lines.filter(Boolean).join("\n");
}

export function renderRunsList(runs) {
  const items = Array.isArray(runs) ? runs : [];
  if (!items.length) return "当前账号没有运行中的微信本地 Agent 任务。";
  return [
    "当前账号运行中的任务：",
    ...items.map((run) => `- ${String(run.chatId ?? "?")} / ${run?.agent?.id ?? "unknown"}: ${String(run.status ?? "running")} (${safeId(run.runId, 12)})`),
  ].join("\n");
}

export function buildPrompt(event, options = {}) {
  const mode = normalizePromptMode(options.mode);
  const mediaLines = Array.isArray(event.mediaFiles) && event.mediaFiles.length
    ? ["", "本地媒体附件:", ...event.mediaFiles.map((file) => `- ${file.kind || "file"} ${file.mimeType || "application/octet-stream"}: ${file.path}`)]
    : [];
  if (mode === "raw") {
    return [event.text, ...mediaLines].filter(Boolean).join("\n").trim();
  }
  const history = Array.isArray(options.history) ? options.history : [];
  const historyLines = history.length
    ? ["", "最近对话:", ...history.map((item) => `- ${item.role || "unknown"}${item.agentId ? `/${item.agentId}` : ""}: ${String(item.text ?? "").trim()}`)]
    : [];
  const agent = options.agent ?? {};
  return [
    `来源: Weixin/iLink`,
    `chat_id: ${event.chatId}`,
    `user_id: ${event.senderId}`,
    event.messageId ? `message_id: ${event.messageId}` : null,
    agent.id ? `agent: ${agent.provider || "unknown"}/${agent.id}` : null,
    `prompt_mode: ${mode}`,
    ...historyLines,
    "",
    "用户消息:",
    event.text,
    ...mediaLines,
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
    if (snapshotState.hasPendingApprovals) return snapshot;
    if (snapshotState.isTerminal) return snapshot;
    await sleep(250);
  }
  return await runtime.getRun({ runId, workspaceRoot: input.workspaceRoot });
}
