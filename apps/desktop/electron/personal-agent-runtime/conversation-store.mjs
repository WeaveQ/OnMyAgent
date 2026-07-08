import fs from "node:fs";
import path from "node:path";

import { readSession, writeSession } from "./session-store.mjs";
import { legacyPersonalAgentRoot, personalAgentRoot, personalAgentRuntimeStateRoot } from "./runtime-state.mjs";
import { readJsonLikeFile, runId, writeJsonFile } from "./utils.mjs";
// Local import (in addition to the re-export below) so internal callers such as
// `listConversationsByProvider` can reference `listChannelConversations`. The
// ESM cycle with `conversation-lookup.mjs` is safe because every cross-module
// reference is resolved at call time, never during module evaluation.
import { listChannelConversations } from "./conversation-lookup.mjs";

export const CONVERSATION_DIR = "conversations";
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

export function normalizeConversation(item, provider, agentId) {
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
  const id = String(input.id ?? "").trim() || `conv-${runId()}`;
  const conversation = normalizeConversation({
    id,
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

// Cross-workspace conversation lookup (by id + channel-scoped enumeration) is
// factored into `conversation-lookup.mjs` so this store keeps only IO / atomic
// write responsibilities. Re-exported here to preserve the public surface used
// by the runtime facade and IPC handlers.
export {
  getConversationById,
  listChannelConversations,
  CHANNEL_AGENT_ID_RE,
} from "./conversation-lookup.mjs";

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

/**
 * Aggregate every conversation that belongs to an agent: the normal sessions
 * stored under `<provider>-<agentId>.json` plus the communication-channel
 * sessions (`source:"channel"`, persisted under scoped `<provider>-<platform>-<hash>`
 * files). Channel sessions are filtered by `provider` so the dropdown for a
 * given agent shows all of its sessions regardless of which file they live in.
 */
export async function listConversationsByProvider(workspaceRoot, provider, agentId = "default") {
  const [normal, channel] = await Promise.all([
    listConversations(workspaceRoot, provider, agentId),
    listChannelConversations(workspaceRoot),
  ]);
  const channelForProvider = channel.conversations.filter((conversation) => conversation.provider === provider);
  const merged = [...normal.conversations, ...channelForProvider].sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    conversations: merged,
    activeConversationId: normal.activeConversationId ?? merged[0]?.id ?? null,
  };
}

/**
 * Import a session's messages (e.g. from the global session archive) into the
 * local runtime as a durable transcript for `conversationId`. Ensures the
 * conversation object exists in the target partition (creating it with the
 * given id when missing) and writes the messages as the conversation's
 * transcript. Used by "resume from archive" so cross-workspace / server-side
 * sessions show their chat history in the local agent view.
 *
 * Archive messages arrive as `{ id?, role, content }` (content may be a string
 * or a structured object); they are normalized to the local
 * `PersonalLocalAgentConversationMessage` shape (`type:"text"`).
 */
export async function importConversationFromArchive(workspaceRoot, provider, agentId = "default", input = {}) {
  const requestedId = String(input.conversationId ?? "").trim();
  console.log("[runtime] importConversationFromArchive", { workspaceRoot, provider, agentId, conversationId: requestedId, messageCount: Array.isArray(input.messages) ? input.messages.length : 0 });
  let conversation = requestedId ? await getConversation(workspaceRoot, provider, agentId, requestedId) : null;
  if (!conversation) {
    conversation = await createConversation(workspaceRoot, provider, agentId, {
      id: requestedId || undefined,
      title: String(input.title ?? "").trim() || "Imported conversation",
      providerSessionId: input.providerSessionId ?? null,
      resumeKey: input.providerSessionId ?? null,
      workdir: input.workdir ?? null,
      source: input.source ?? "session-archive-resume",
    });
  }
  const conversationId = conversation.id;
  const rawMessages = Array.isArray(input.messages) ? input.messages : [];
  const messages = rawMessages.map((raw, index) => {
    const message = raw && typeof raw === "object" ? raw : {};
    const role = String(message.role ?? "assistant");
    const safeRole = role === "user" || role === "assistant" || role === "system" ? role : "assistant";
    const content = message.content;
    const text = typeof content === "string" ? content : (content == null ? "" : JSON.stringify(content));
    return {
      id: String(message.id ?? `imported-${conversationId}-${index}`),
      type: "text",
      role: safeRole,
      text,
      createdAt: Number(message.createdAt) || Date.now() + index,
    };
  });
  console.log("[runtime] writing", { conversationId, messageCount: messages.length });
  await writeConversationEvents(workspaceRoot, provider, agentId, conversationId, [], messages);
  return { conversation, importedMessageCount: messages.length };
}
