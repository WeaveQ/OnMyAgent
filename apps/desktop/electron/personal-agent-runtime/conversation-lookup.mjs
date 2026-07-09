import fs from "node:fs";
import path from "node:path";

import { personalAgentRuntimeStateRoot } from "./runtime-state.mjs";
import { readJsonLikeFile } from "./utils.mjs";
import {
  CONVERSATION_DIR,
  conversationRoot,
  normalizeConversation,
} from "./conversation-store.mjs";

/**
 * @typedef {Object} ConversationSummary
 * @property {string} id
 * @property {string} provider
 * @property {string} agentId
 * @property {string} title
 * @property {string | null} providerSessionId
 * @property {string | null} resumeKey
 * @property {string | null} workdir
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {string | null} lastRunId
 * @property {string | null} lastStatus
 * @property {string} source
 * @property {object | null} metadata
 */

/**
 * Scoped runtime agents used by messaging channels embed the platform in their
 * id: `<provider>-<agent>-<platform>-<hash>`. Historical bindings (before we
 * started tagging source:"channel") persist without that tag, so we recognise
 * channel-scoped agent ids by filename pattern and treat them as channel
 * conversations for the Studio "Channel sessions" group.
 */
export const CHANNEL_AGENT_ID_RE = /-(weixin|feishu|wecom|lark|dingtalk|telegram)-[a-f0-9]+$/i;

/**
 * Enumerate every workspace's `conversations/*.json` file rather than just the
 * current one. Channel / IM conversations are bound to a person or chat, not to
 * the code workspace the Studio tab happens to be viewing, so they can end up
 * in any of the workspace identity directories under the runtime-state root.
 *
 * @returns {Promise<Array<{ file: string, dir: string }>>}
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

/**
 * Locate a conversation by id across ALL agent files in the workspace,
 * ignoring the provider/agentId partition. Used to open conversations that do
 * not live under the currently selected ACP agent (e.g. channel-bound
 * conversations created under a scoped `-feishu-<hash>` agent, or sessions
 * restored from the global session manager). Returns null if not found.
 *
 * @param {string} workspaceRoot
 * @param {string} conversationId
 * @returns {Promise<ConversationSummary | null>}
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
      if (normalized && CHANNEL_AGENT_ID_RE.test(agentId)) {
        normalized.source = "channel";
      }
      return normalized;
    }
  }
  return null;
}

/**
 * Return every conversation tagged source:"channel" across all agent files in
 * the workspace. This powers the Studio "Channel sessions" group so that
 * IM-bound conversations (which live under scoped agents not present in the ACP
 * agent list) are still visible and switchable in the UI.
 *
 * @param {string} workspaceRoot
 * @returns {Promise<{ conversations: ConversationSummary[] }>}
 */
export async function listChannelConversations(workspaceRoot) {
  // Scan every workspace directory, not just the current one, because IM
  // conversations are bound to a chat/person and may have been persisted under
  // a different workspaceRoot than the Studio tab is currently viewing.
  const files = await listAllConversationFiles();
  const result = [];
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
