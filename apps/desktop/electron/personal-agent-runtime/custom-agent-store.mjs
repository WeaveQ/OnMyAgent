import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { personalAgentRoot } from "./runtime-state.mjs";

function storeFile(workspaceRoot) {
  return path.join(personalAgentRoot(workspaceRoot), "custom-agents.json");
}

function textValue(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function stringList(value) {
  return Array.isArray(value) ? value.map((item) => textValue(item)).filter(Boolean) : [];
}

function envObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    const name = textValue(key);
    if (name) result[name] = String(raw ?? "");
  }
  return result;
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (text === "true" || text === "1" || text === "yes" || text === "on") return true;
  if (text === "false" || text === "0" || text === "no" || text === "off") return false;
  return fallback;
}

function normalizeConnectionType(value) {
  const text = textValue(value).toLowerCase();
  return text === "cli" || text === "acp" ? "cli" : "raw";
}

function normalizeCustomAgent(input = {}) {
  const id = textValue(input.id) || `custom-${Date.now().toString(36)}`;
  const name = textValue(input.name) || id;
  const executablePath = textValue(input.executablePath ?? input.command);
  if (!executablePath) throw new Error("custom agent command is required");
  const connectionType = normalizeConnectionType(input.connectionType);
  const supportsAcp = connectionType === "cli" ? boolValue(input.supportsAcp, true) : false;
  const acpArgs = stringList(input.acpArgs);
  return {
    id,
    name,
    provider: "custom",
    executablePath,
    customArgs: stringList(input.customArgs ?? input.args),
    acpArgs,
    connectionType,
    env: envObject(input.env),
    description: textValue(input.description) || null,
    nativeSkillsDirs: stringList(input.nativeSkillsDirs ?? input.native_skills_dirs),
    behaviorPolicy: input.behaviorPolicy && typeof input.behaviorPolicy === "object" ? input.behaviorPolicy : {},
    supportsAcp,
    supportsStreaming: boolValue(input.supportsStreaming, supportsAcp),
    supportsResume: boolValue(input.supportsResume, false),
    supportsApproval: boolValue(input.supportsApproval, false),
    supportsModelOverride: boolValue(input.supportsModelOverride, false),
    supportsPermissionAutoApprove: boolValue(input.supportsPermissionAutoApprove, false),
    authRequired: boolValue(input.authRequired, false),
    status: "online",
    enabled: input.enabled !== false,
    agent_source: textValue(input.agent_source) || "custom",
    extensionName: textValue(input.extensionName) || null,
    customAgentSourceId: textValue(input.customAgentSourceId ?? input.custom_agent_id) || null,
    connectionMode: supportsAcp ? "Custom ACP session" : "Custom command",
    updatedAt: Date.now(),
  };
}

async function readStore(workspaceRoot) {
  try {
    const raw = await readFile(storeFile(workspaceRoot), "utf8");
    const parsed = JSON.parse(raw);
    return {
      agents: Array.isArray(parsed?.agents) ? parsed.agents : [],
      overrides: parsed?.overrides && typeof parsed.overrides === "object" ? parsed.overrides : {},
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { agents: [], overrides: {} };
    throw error;
  }
}

async function writeStore(workspaceRoot, store) {
  const file = storeFile(workspaceRoot);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify({ agents: store.agents ?? [], overrides: store.overrides ?? {} }, null, 2)}\n`, "utf8");
}

export async function listCustomAgents(workspaceRoot) {
  const store = await readStore(workspaceRoot);
  return store.agents.map((agent) => normalizeCustomAgent(agent));
}

export async function createCustomAgent(workspaceRoot, input = {}) {
  const store = await readStore(workspaceRoot);
  const agent = normalizeCustomAgent(input);
  if (store.agents.some((item) => item.id === agent.id)) throw new Error(`custom agent already exists: ${agent.id}`);
  store.agents.push(agent);
  await writeStore(workspaceRoot, store);
  return { agent };
}

export async function updateCustomAgent(workspaceRoot, id, input = {}) {
  const store = await readStore(workspaceRoot);
  const agentId = textValue(id ?? input.id);
  const index = store.agents.findIndex((item) => item.id === agentId);
  if (index < 0) throw new Error(`custom agent not found: ${agentId}`);
  const agent = normalizeCustomAgent({ ...store.agents[index], ...input, id: agentId });
  store.agents[index] = agent;
  await writeStore(workspaceRoot, store);
  return { agent };
}

export async function deleteCustomAgent(workspaceRoot, id) {
  const store = await readStore(workspaceRoot);
  const agentId = textValue(id);
  const next = store.agents.filter((agent) => agent.id !== agentId);
  const deleted = next.length !== store.agents.length;
  store.agents = next;
  delete store.overrides[agentId];
  await writeStore(workspaceRoot, store);
  return { ok: true, deleted };
}

export async function getAgentOverrides(workspaceRoot, id) {
  const store = await readStore(workspaceRoot);
  const agentId = textValue(id);
  return { overrides: store.overrides[agentId] ?? {} };
}

export async function setAgentOverrides(workspaceRoot, id, overrides = {}) {
  const store = await readStore(workspaceRoot);
  const agentId = textValue(id);
  if (!agentId) throw new Error("agent id is required");
  store.overrides[agentId] = overrides && typeof overrides === "object" ? overrides : {};
  await writeStore(workspaceRoot, store);
  return { overrides: store.overrides[agentId] };
}
