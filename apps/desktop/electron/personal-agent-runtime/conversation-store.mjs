import path from "node:path";

import { readSession, writeSession } from "./session-store.mjs";
import { legacyPersonalAgentRoot, personalAgentRoot } from "./runtime-state.mjs";
import { readJsonLikeFile, runId, writeJsonFile } from "./utils.mjs";

const CONVERSATION_DIR = "conversations";
const CONVERSATION_EVENTS_DIR = "conversation-events";

export function conversationRoot(workspaceRoot) {
  return path.join(personalAgentRoot(workspaceRoot), CONVERSATION_DIR);
}

export function conversationFile(workspaceRoot, provider, agentId = "default") {
  return path.join(conversationRoot(workspaceRoot), `${provider}-${agentId}.json`);
}

export function legacyConversationFile(workspaceRoot, provider, agentId = "default") {
  return path.join(legacyPersonalAgentRoot(workspaceRoot), CONVERSATION_DIR, `${provider}-${agentId}.json`);
}

export function conversationEventsFile(workspaceRoot, provider, agentId = "default", conversationId = "default") {
  const id = String(conversationId ?? "").trim() || "default";
  return path.join(personalAgentRoot(workspaceRoot), CONVERSATION_EVENTS_DIR, `${provider}-${agentId}-${id}.json`);
}

function nowTitle(timestamp) {
  return `Conversation ${new Date(timestamp).toISOString().replace("T", " ").slice(0, 19)}`;
}

function normalizeConversation(item, provider, agentId) {
  if (!item || typeof item !== "object") return null;
  const id = String(item.id ?? "").trim();
  if (!id) return null;
  const createdAt = Number(item.createdAt) || Date.now();
  const updatedAt = Number(item.updatedAt) || createdAt;
  return {
    id,
    provider,
    agentId,
    title: String(item.title ?? "").trim() || nowTitle(createdAt),
    providerSessionId: String(item.providerSessionId ?? item.sessionId ?? "").trim() || null,
    resumeKey: String(item.resumeKey ?? item.providerSessionId ?? item.sessionId ?? "").trim() || null,
    workdir: String(item.workdir ?? "").trim() || null,
    createdAt,
    updatedAt,
    lastRunId: String(item.lastRunId ?? "").trim() || null,
    lastStatus: String(item.lastStatus ?? "").trim() || null,
    source: String(item.source ?? "studio-created").trim() || "studio-created",
    metadata: item.metadata && typeof item.metadata === "object" ? item.metadata : null,
  };
}

async function readConversationState(workspaceRoot, provider, agentId = "default") {
  const raw = await readJsonLikeFile(conversationFile(workspaceRoot, provider, agentId))
    ?? await readJsonLikeFile(legacyConversationFile(workspaceRoot, provider, agentId));
  const conversations = Array.isArray(raw?.conversations)
    ? raw.conversations.map((item) => normalizeConversation(item, provider, agentId)).filter(Boolean)
    : [];
  return {
    version: 1,
    activeConversationId: String(raw?.activeConversationId ?? "").trim() || null,
    conversations,
  };
}

async function writeConversationState(workspaceRoot, provider, agentId, state) {
  await writeJsonFile(conversationFile(workspaceRoot, provider, agentId), {
    version: 1,
    activeConversationId: state.activeConversationId ?? state.conversations[0]?.id ?? null,
    conversations: state.conversations,
  });
}

async function migrateLegacySession(workspaceRoot, provider, agentId, state) {
  if (state.conversations.length) return state;
  const legacy = await readSession(workspaceRoot, provider, agentId);
  const sessionId = String(legacy.sessionId ?? legacy.threadId ?? legacy.opencodeSessionId ?? "").trim();
  const timestamp = Number(legacy.updatedAt) || Date.now();
  const conversation = normalizeConversation({
    id: `conv-${runId()}`,
    title: "Default conversation",
    providerSessionId: sessionId || null,
    resumeKey: sessionId || null,
    workdir: legacy.workdir ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    source: sessionId ? "legacy-session" : "studio-created",
  }, provider, agentId);
  state.conversations = [conversation];
  state.activeConversationId = conversation.id;
  await writeConversationState(workspaceRoot, provider, agentId, state);
  return state;
}

export async function listConversations(workspaceRoot, provider, agentId = "default") {
  const state = await migrateLegacySession(
    workspaceRoot,
    provider,
    agentId,
    await readConversationState(workspaceRoot, provider, agentId),
  );
  return {
    conversations: [...state.conversations].sort((a, b) => b.updatedAt - a.updatedAt),
    activeConversationId: state.activeConversationId ?? state.conversations[0]?.id ?? null,
  };
}

export async function createConversation(workspaceRoot, provider, agentId = "default", input = {}) {
  const state = await migrateLegacySession(
    workspaceRoot,
    provider,
    agentId,
    await readConversationState(workspaceRoot, provider, agentId),
  );
  const timestamp = Date.now();
  const conversation = normalizeConversation({
    id: `conv-${runId()}`,
    title: String(input.title ?? "").trim() || nowTitle(timestamp),
    providerSessionId: input.providerSessionId ?? null,
    resumeKey: input.resumeKey ?? input.providerSessionId ?? null,
    workdir: input.workdir ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
    source: input.source ?? "studio-created",
    metadata: input.metadata ?? null,
  }, provider, agentId);
  state.conversations = [conversation, ...state.conversations];
  state.activeConversationId = conversation.id;
  await writeConversationState(workspaceRoot, provider, agentId, state);
  if (conversation.providerSessionId || conversation.workdir) {
    await writeSession(workspaceRoot, provider, agentId, {
      sessionId: conversation.providerSessionId,
      workdir: conversation.workdir,
      updatedAt: conversation.updatedAt,
    });
  }
  return conversation;
}

export async function getOrCreateConversation(workspaceRoot, provider, agentId = "default", conversationId = "") {
  const listed = await listConversations(workspaceRoot, provider, agentId);
  const requested = String(conversationId ?? "").trim();
  const found = listed.conversations.find((item) => item.id === requested)
    ?? listed.conversations.find((item) => item.id === listed.activeConversationId)
    ?? listed.conversations[0];
  if (found) return found;
  return createConversation(workspaceRoot, provider, agentId, { title: "Default conversation" });
}

export async function getConversation(workspaceRoot, provider, agentId = "default", conversationId = "") {
  const listed = await listConversations(workspaceRoot, provider, agentId);
  const requested = String(conversationId ?? "").trim();
  const conversation = listed.conversations.find((item) => item.id === requested)
    ?? listed.conversations.find((item) => item.id === listed.activeConversationId)
    ?? null;
  return conversation;
}

export async function updateConversation(workspaceRoot, provider, agentId = "default", conversationId, patch = {}) {
  const state = await migrateLegacySession(
    workspaceRoot,
    provider,
    agentId,
    await readConversationState(workspaceRoot, provider, agentId),
  );
  const id = String(conversationId ?? "").trim();
  const index = state.conversations.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const current = state.conversations[index];
  const updated = normalizeConversation({
    ...current,
    ...patch,
    id: current.id,
    updatedAt: patch.updatedAt ?? Date.now(),
  }, provider, agentId);
  state.conversations[index] = updated;
  state.activeConversationId = updated.id;
  await writeConversationState(workspaceRoot, provider, agentId, state);
  if (updated.providerSessionId || updated.workdir) {
    await writeSession(workspaceRoot, provider, agentId, {
      sessionId: updated.providerSessionId,
      workdir: updated.workdir,
      updatedAt: updated.updatedAt,
    });
  }
  return updated;
}

export async function resetConversationPointer(workspaceRoot, provider, agentId = "default", conversationId = "") {
  const conversation = await getOrCreateConversation(workspaceRoot, provider, agentId, conversationId);
  return updateConversation(workspaceRoot, provider, agentId, conversation.id, {
    providerSessionId: null,
    resumeKey: null,
    workdir: null,
    lastRunId: null,
    lastStatus: null,
    source: "studio-created",
  });
}

export async function writeConversationEvents(workspaceRoot, provider, agentId = "default", conversationId = "", events = [], messages = []) {
  const id = String(conversationId ?? "").trim();
  if (!id) return null;
  const normalizedEvents = Array.isArray(events) ? events : [];
  const normalizedMessages = Array.isArray(messages) ? messages : [];
  const payload = {
    version: 1,
    provider,
    agentId,
    conversationId: id,
    updatedAt: Date.now(),
    events: normalizedEvents,
    messages: normalizedMessages,
  };
  await writeJsonFile(conversationEventsFile(workspaceRoot, provider, agentId, id), payload);
  return payload;
}

export async function readConversationEvents(workspaceRoot, provider, agentId = "default", conversationId = "") {
  const id = String(conversationId ?? "").trim();
  if (!id) return { events: [], messages: [] };
  const raw = await readJsonLikeFile(conversationEventsFile(workspaceRoot, provider, agentId, id));
  return {
    version: Number(raw?.version) || 1,
    provider,
    agentId,
    conversationId: id,
    updatedAt: Number(raw?.updatedAt) || null,
    events: Array.isArray(raw?.events) ? raw.events : [],
    messages: Array.isArray(raw?.messages) ? raw.messages : [],
  };
}
