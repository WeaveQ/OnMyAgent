import os from "node:os";
import path from "node:path";

import { normalizePersonalLocalAgent } from "../personal-agent-runtime/provider-registry.mjs";
import {
  ONMYAGENT_ASSISTANT_AGENT_ID,
  createOnMyAgentAssistantAgent,
} from "../channels/assistant-bridge.mjs";
import {
  DEFAULT_HISTORY_LIMIT,
  DEFAULT_HISTORY_STORE_LIMIT,
  DEFAULT_TEXT_BATCH_DELAY_MS,
} from "./helpers.mjs";

const DEFAULT_WORKSPACE_ROOT = path.join(os.homedir(), ".onmyagent", "weixin-workspace");

export function normalizeRuntimeOptions(input = {}) {
  const agent = normalizePersonalLocalAgent(input.agent ?? { provider: "opencode" });
  const availableAgents = normalizeAvailableAgents(input.availableAgents ?? input.agents, agent);
  const allowedUsers = normalizeList(input.allowedUsers ?? input.allowFrom);
  const allowedGroups = normalizeList(input.allowedGroups ?? input.groupAllowFrom);
  const dmPolicy = normalizePolicy(input.dmPolicy, allowedUsers, "allowlist");
  const groupPolicy = normalizePolicy(input.groupPolicy, allowedGroups, "disabled");
  return {
    workspaceRoot: String(input.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT),
    accessibleWorkspaceRoots: normalizeAccessibleWorkspaceRoots(input.accessibleWorkspaceRoots, input.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT),
    agent,
    availableAgents,
    agentByChat: new Map(),
    modelByChat: new Map(),
    promptModeByChat: new Map(),
    approvalMode: normalizeApprovalMode(input.approvalMode),
    promptMode: normalizePromptMode(input.promptMode),
    dmPolicy,
    allowedUsers,
    groupPolicy,
    allowedGroups,
    textBatchDelayMs: Number.isFinite(Number(input.textBatchDelayMs)) ? Math.max(0, Number(input.textBatchDelayMs)) : DEFAULT_TEXT_BATCH_DELAY_MS,
    sendChunkDelayMs: Number.isFinite(Number(input.sendChunkDelayMs)) ? Math.max(0, Number(input.sendChunkDelayMs)) : 1500,
    timeoutMs: Number.isFinite(Number(input.timeoutMs)) ? Number(input.timeoutMs) : undefined,
    historyLimit: Number.isFinite(Number(input.historyLimit)) ? Math.max(0, Number(input.historyLimit)) : DEFAULT_HISTORY_LIMIT,
    historyStoreLimit: Number.isFinite(Number(input.historyStoreLimit)) ? Math.max(1, Number(input.historyStoreLimit)) : DEFAULT_HISTORY_STORE_LIMIT,
  };
}

export function normalizeApprovalMode(value) {
  const mode = String(value ?? "ask").trim();
  if (mode === "auto" || mode === "ask" || mode === "read-only-auto") return mode;
  return "ask";
}

export function normalizeAccessibleWorkspaceRoots(value, workspaceRoot = "") {
  const primary = String(workspaceRoot ?? "").trim();
  const source = Array.isArray(value) ? value : String(value ?? "").split(",");
  const seen = new Set();
  const roots = [];
  for (const item of source) {
    const root = String(item ?? "").trim();
    if (!root || root === primary || seen.has(root)) continue;
    seen.add(root);
    roots.push(root);
  }
  return roots;
}

export function normalizePromptMode(value) {
  const mode = String(value ?? "raw").trim().toLowerCase();
  if (mode === "debug") return "debug";
  return "raw";
}

export function normalizeAvailableAgents(value, fallbackAgent) {
  const source = Array.isArray(value) ? value : [];
  const byId = new Map();
  for (const item of [fallbackAgent, ...source]) {
    const agent = normalizePersonalLocalAgent(item);
    byId.set(agent.id, agent);
  }
  if (!byId.has(ONMYAGENT_ASSISTANT_AGENT_ID)) {
    byId.set(ONMYAGENT_ASSISTANT_AGENT_ID, createOnMyAgentAssistantAgent());
  }
  return [...byId.values()];
}

export function normalizeList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
}

export function normalizePolicy(value, allowlist, fallback) {
  const policy = String(value ?? fallback).trim();
  if (policy === "allowlist" && allowlist.length === 0) return "open";
  if (policy === "open" || policy === "disabled" || policy === "allowlist") return policy;
  return fallback;
}

export function isAllowed(options, chat, senderId) {
  if (chat.chatType === "group") {
    if (options.groupPolicy === "disabled") return false;
    if (options.groupPolicy === "allowlist") return options.allowedGroups.includes(chat.chatId);
    return true;
  }
  if (options.dmPolicy === "disabled") return false;
  if (options.dmPolicy === "allowlist") return options.allowedUsers.includes(senderId);
  return true;
}
