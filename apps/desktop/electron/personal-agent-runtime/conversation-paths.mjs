import path from "node:path";

import { personalAgentRoot } from "./runtime-state.mjs";

/**
 * Pure path constants and normalization for Personal-agent conversations.
 *
 * Extracted from `conversation-store.mjs` so that `conversation-lookup.mjs`
 * (which only needs these pure helpers) does not have to import the store, and
 * vice versa. This keeps the conversation IO layer acyclic.
 */

export const CONVERSATION_DIR = "conversations";

export function conversationRoot(workspaceRoot) {
  return path.join(personalAgentRoot(workspaceRoot), CONVERSATION_DIR);
}

export function nowTitle(timestamp) {
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
