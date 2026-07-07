import fs from "node:fs";
import path from "node:path";

import { readSession, writeSession } from "./session-store.mjs";
import { legacyPersonalAgentRoot, personalAgentRoot, personalAgentRuntimeStateRoot } from "./runtime-state.mjs";
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

/**
 * Channel / IM conversations are bound to a person or chat, not to the code
 * workspace the Studio tab happens to be viewing. They are persisted under
 * whatever `workspaceRoot` the messaging service was started with, so they can
 * end up in any of the workspace identity directories under the runtime-state
 * root. To make them discoverable from any workspace, we enumerate every
 * workspace's `conversations/*.json` file rather than just the current one.
 *
 * Returns an array of { file, dir } absolute paths.
 */
async function listAllConversationFiles() {
  const root = path.join(personalAgentRuntimeStateRoot(), "personal-assistant", "workspaces");
  let workspaceDirs = [];
  try {
    workspaceDirs = (await fs.promises.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name, CONVERSATION_DIR));
  } catch {
    return [];
  }
  const files = [];
  for (const dir of workspaceDirs) {
    let names = [];
    try {
      names = await fs.promises.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      files.push({ file: path.join(dir, name), dir });
    }
  }
  return files;
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

/**
 * Locate a conversation by id across ALL agent files in the workspace,
 * ignoring the provider/agentId partition. Used to open conversations that
 * do not live under the currently selected ACP agent (e.g. channel-bound
 * conversations created under a scoped `-feishu-<hash>` agent, or sessions
 * restored from the global session manager). Returns null if not found.
 */
export async function getConversationById(workspaceRoot, conversationId) {
  const requested = String(conversationId ?? "").trim();
  if (!requested) return null;
  // Search the current workspace first (fast path), then fall back to scanning
  // every workspace so IM-bound conversations are reachable from any view.
  const scoped = workspaceRoot ? conversationRoot(workspaceRoot) : null;
  const candidates = [];
  if (scoped) {
    try {
      for (const name of await fs.promises.readdir(scoped)) {
        if (name.endsWith(".json")) candidates.push({ file: path.join(scoped, name), dir: scoped });
      }
    } catch {
      // ignore missing directory
    }
  }
  const all = await listAllConversationFiles();
  const seen = new Set(candidates.map((item) => item.file));
  for (const item of all) {
    if (!seen.has(item.file)) candidates.push(item);
  }
  for (const { file } of candidates) {
    const raw = await readJsonLikeFile(file).catch(() => null);
    const conversations = Array.isArray(raw?.conversations) ? raw.conversations : [];
    const match = conversations.find((item) => {
      const id = String(item?.id ?? "");
      const providerSessionId = String(item?.providerSessionId ?? item?.sessionId ?? "");
      const resumeKey = String(item?.resumeKey ?? "");
      return id === requested || (providerSessionId && providerSessionId === requested) || (resumeKey && resumeKey === requested);
    });
    if (match) {
      const [provider, ...rest] = path.basename(file).replace(/\.json$/, "").split("-");
      const agentId = rest.join("-") || "default";
      const normalized = normalizeConversation(match, provider, agentId);
      // If the conversation lives under a scoped channel agent id (e.g.
      // `codex-weixin-<hash>`) treat it as a channel-bound conversation
      // even if the persisted `source` was left as the default. This lets
      // resume-from-archive route the UI to the channel sessions group
      // instead of creating a phantom ACP-agent conversation.
      if (normalized && /-(weixin|feishu|wecom|lark|dingtalk|telegram)-[a-f0-9]+$/i.test(agentId)) {
        normalized.source = "channel";
      }
      return normalized;
    }
  }
  return null;
}

/**
 * Return every conversation tagged source:"channel" across all agent files
 * in the workspace. This powers the Studio "Channel sessions" group so that
 * IM-bound conversations (which live under scoped agents not present in the
 * ACP agent list) are still visible and switchable in the UI.
 */
export async function listChannelConversations(workspaceRoot) {
  // Scan every workspace directory, not just the current one, because IM
  // conversations are bound to a chat/person and may have been persisted under
  // a different workspaceRoot than the Studio tab is currently viewing.
  const files = await listAllConversationFiles();
  const result = [];
  // Scoped runtime agents used by messaging channels embed the platform
  // in their id: `<provider>-<agent>-<platform>-<hash>`. Historical bindings
  // (before we started tagging source:"channel") persist without that tag,
  // so we also recognise channel-scoped agent files by filename pattern and
  // treat them as channel conversations for the Studio "Channel sessions"
  // group. The synthetic `channel` source is applied on the returned copy
  // only; the on-disk file is not rewritten here.
  const CHANNEL_AGENT_ID_RE = /-(weixin|feishu|wecom|lark|dingtalk|telegram)-[a-f0-9]+$/i;
  for (const { file } of files) {
    const raw = await readJsonLikeFile(file).catch(() => null);
    const conversations = Array.isArray(raw?.conversations) ? raw.conversations : [];
    const basename = path.basename(file).replace(/\.json$/, "");
    const [fileProvider, ...rest] = basename.split("-");
    const fileAgentId = rest.join("-") || "default";
    const fileIsChannelScoped = CHANNEL_AGENT_ID_RE.test(fileAgentId);
    for (const item of conversations) {
      const normalized = normalizeConversation(item, "unknown", "unknown");
      if (!normalized) continue;
      const isChannel = normalized.source === "channel" || fileIsChannelScoped;
      if (!isChannel) continue;
      normalized.provider = fileProvider;
      normalized.agentId = fileAgentId;
      normalized.source = "channel";
      result.push(normalized);
    }
  }
  result.sort((a, b) => b.updatedAt - a.updatedAt);
  return { conversations: result };
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
