// AssistantBridge: routes an IM chat bound to the `onmyagent` pseudo-agent to
// the desktop "助理" tab. It talks to the SAME OpenCode instance the assistant
// tab uses, via the OnMyAgent server proxy (opencodeBaseUrl + Bearer token).
// Because the assistant tab's session list (`listWorkspaceSessions`) proxies
// `opencode.session.list` with no surface filtering (P0-03), a session created
// here appears natively in the assistant tab — zero renderer changes.
//
// This is a strictly additive dispatch path: only chats whose bound agent has
// provider `onmyagent-assistant` reach this module. Every other agent keeps
// using the ACP runtime exactly as before (no behavior change for codex/claude/
// opencode/etc.).
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

const POLL_INTERVAL_MS = 900;
const POLL_TIMEOUT_MS = 180_000;

function assistantMessageKey(message) {
  const id = String(message?.info?.id ?? message?.info?.messageID ?? message?.id ?? "").trim();
  if (id) return `id:${id}`;
  const role = String(message?.info?.role ?? message?.role ?? "").toLowerCase();
  if (role !== "assistant") return "";
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const text = parts
    .map((part) => (part && part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  return text ? `text:${text}` : "";
}

function collectAssistantText(message) {
  const role = String(message?.info?.role ?? message?.role ?? "").toLowerCase();
  if (role !== "assistant") return "";
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .map((part) => {
      if (!part || part.ignored) return "";
      if (part.type === "text" && typeof part.text === "string") return part.text;
      if (typeof part.errorText === "string") return part.errorText;
      return "";
    })
    .filter((text) => text.trim())
    .join("\n")
    .trim();
}

function latestNewAssistantText(messages, existingKeys) {
  for (const message of (messages ?? []).slice().reverse()) {
    const key = assistantMessageKey(message);
    if (key && existingKeys.has(key)) continue;
    const text = collectAssistantText(message);
    if (text) return text;
  }
  return "";
}

function trackPromise(promise) {
  const state = { status: "pending", value: undefined, reason: undefined };
  promise.then(
    (value) => { state.status = "fulfilled"; state.value = value; },
    (reason) => { state.status = "rejected"; state.reason = reason; },
  );
  return state;
}

async function pollAssistantText(client, sessionId, directory, existingKeys, promptState, appendLog) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = "pending";
  while (Date.now() < deadline) {
    if (promptState) {
      if (promptState.status === "rejected") throw promptState.reason;
      if (promptState.status === "fulfilled" && promptState.value?.error) {
        throw new Error(typeof promptState.value.error === "string" ? promptState.value.error : JSON.stringify(promptState.value.error).slice(0, 300));
      }
    }
    const messagesResult = await client.session.messages({ sessionID: sessionId, directory, limit: 50 });
    if (messagesResult.error) {
      throw new Error(
        typeof messagesResult.error === "string" ? messagesResult.error : "failed to read assistant messages",
      );
    }
    const output = latestNewAssistantText(messagesResult.data ?? [], existingKeys);
    if (output.trim()) return output;
    const status = promptState?.status ?? "pending";
    if (status !== lastStatus) {
      lastStatus = status;
      appendLog?.({ type: "log", text: `assistant-bridge: poll promptState=${status} messages=${(messagesResult.data ?? []).length}` });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("本地助理会话超时未返回回复");
}

/**
 * @param {object} input
 * @param {object} [input.opencodeConnection] - { opencodeBaseUrl, onmyagentServerToken, opencodeAuthorization }
 * @param {string} input.workspaceRoot
 * @param {string} input.chatId
 * @param {string} input.text
 * @param {() => Promise<string|null>} [input.readSessionId] - returns persisted OpenCode session id for this chat
 * @param {(id: string) => Promise<void>} [input.writeSessionId] - persists the OpenCode session id for this chat
 * @param {Function} [input.createClient] - injectable for tests (defaults to real OpenCode SDK client)
 * @param {(entry: { type: string, text: string }) => void} [input.appendLog] - optional structured logger from the channel service
 */
export async function runAssistantTurn(input) {
  const {
    opencodeConnection,
    workspaceRoot,
    chatId,
    text,
    readSessionId,
    writeSessionId,
    createClient = createOpencodeClient,
    appendLog,
  } = input;

  const baseUrl = opencodeConnection?.opencodeBaseUrl;
  const token = opencodeConnection?.onmyagentServerToken;
  const authorization = opencodeConnection?.opencodeAuthorization || (token ? `Bearer ${token}` : "");
  const authKind = authorization.startsWith("Basic ") ? "Basic" : authorization.startsWith("Bearer ") ? "Bearer" : authorization ? "other" : "none";
  appendLog?.({ type: "log", text: `assistant-bridge: connection baseUrl=${baseUrl} auth=${authKind} hasToken=${Boolean(token)}` });
  if (!baseUrl || !authorization) {
    throw new Error("OpenCode 连接不可用：缺少 opencodeBaseUrl 或认证信息（assistant bridge）。");
  }
  const directory = opencodeConnection?.workspacePath || String(workspaceRoot ?? "").trim() || undefined;
  appendLog?.({ type: "log", text: `assistant-bridge: directory=${directory} workspacePath=${opencodeConnection?.workspacePath} workspaceRoot=${workspaceRoot}` });

  const client = createClient({ baseUrl, directory, headers: { authorization } });

  let sessionId = String((typeof readSessionId === "function" ? await readSessionId() : null) ?? "").trim();
  if (sessionId) {
    const existing = await client.session.get({ sessionID: sessionId, directory });
    const existingDir = existing?.data?.directory ?? existing?.directory ?? existing?.data?.worktree ?? existing?.worktree ?? null;
    appendLog?.({ type: "log", text: `assistant-bridge: resume session=${sessionId} dir=${existingDir} target=${directory} err=${JSON.stringify(existing?.error)?.slice(0, 120)}` });
    if (existing.error || (directory && existingDir && String(existingDir) !== String(directory))) {
      appendLog?.({ type: "log", text: `assistant-bridge: stale session ${sessionId}, recreating` });
      sessionId = "";
    }
  }
  if (!sessionId) {
    appendLog?.({ type: "log", text: `assistant-bridge: creating OpenCode session for chat ${chatId}` });
    const created = await client.session.create({ directory, title: `本地助理 · IM (${chatId})` });
    sessionId = created.data?.id ?? created.id;
    if (typeof writeSessionId === "function") await writeSessionId(sessionId);
  }

  const before = await client.session.messages({ sessionID: sessionId, directory, limit: 100 });
  const existingKeys = new Set((before.data ?? []).map((message) => assistantMessageKey(message)).filter(Boolean));

  appendLog?.({ type: "log", text: `assistant-bridge: prompting session ${sessionId}` });
  const promptState = trackPromise(client.session.promptAsync({ sessionID: sessionId, directory, agent: "build", parts: [{ type: "text", text }] }));

  const output = await pollAssistantText(client, sessionId, directory, existingKeys, promptState, appendLog);
  return { output, sessionId };
}

// Synthetic pseudo-agent for the desktop "助理" tab route.
//
// OnMyAgent itself is the control plane (it orchestrates local CLI agents), so
// it is intentionally absent from PERSONAL_LOCAL_AGENT_PROVIDERS. IM users can
// still route a chat to the desktop assistant tab via `#agent onmyagent`. This
// synthetic agent keeps provider `onmyagent-assistant` (it is NOT run through
// normalizePersonalLocalAgent, which would force the provider back to
// "opencode") so the dispatch layer can branch to the bridge. Pure additive:
// existing codex/claude/opencode/etc. agents are untouched.
export const ONMYAGENT_ASSISTANT_AGENT_ID = "onmyagent";
export const ONMYAGENT_ASSISTANT_PROVIDER = "onmyagent-assistant";

export function createOnMyAgentAssistantAgent() {
  return {
    id: ONMYAGENT_ASSISTANT_AGENT_ID,
    provider: ONMYAGENT_ASSISTANT_PROVIDER,
    name: "本地助理 OnMyAgent",
    executablePath: "",
    model: null,
    customArgs: [],
    modelOptions: [],
    defaultModel: null,
  };
}

/**
 * Shared dispatch path used by weixin / feishu / channels agent-dispatch when a
 * chat is bound to the `onmyagent` pseudo-agent. Runs one assistant turn against
 * the desktop assistant tab's OpenCode instance and hands the reply text back to
 * the caller via `deliverReply` (each channel sends replies differently).
 *
 * @param {object} deps
 * @param {object} deps.runtime - personal agent runtime (provides getOpencodeConnection)
 * @param {object} deps.store - channel store (provides writeChatSetting)
 * @param {object} deps.session - channel session
 * @param {object} deps.event - inbound message event ({ chatId, senderId, text })
 * @param {string} deps.platformLabel - platform name for log/error prefixes
 * @param {(session: object, chatId: string) => Promise<object|null>} deps.readChatSetting
 * @param {(session: object, event: object, text: string) => Promise<void>} deps.deliverReply
 * @param {(entry: { type: string, text: string }) => void} [deps.appendLog]
 * @returns {Promise<{ output: string, sessionId: string|null }>}
 */
export async function runAssistantBridgeTurn(deps) {
  const { runtime, store, session, event, platformLabel, readChatSetting, deliverReply, appendLog } = deps;
  const connection = typeof runtime?.getOpencodeConnection === "function"
    ? await runtime.getOpencodeConnection()
    : null;
  const result = await runAssistantTurn({
    opencodeConnection: connection,
    workspaceRoot: session.options.workspaceRoot,
    chatId: event.chatId,
    text: event.text,
    readSessionId: async () => {
      const setting = await readChatSetting(session, event.chatId);
      return setting?.assistantSessionId ?? null;
    },
    writeSessionId: async (id) => {
      await store.writeChatSetting(session.account.accountId, event.chatId, { assistantSessionId: id }).catch(() => undefined);
    },
    appendLog,
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    appendLog?.({ type: "error", text: `${platformLabel} assistant-bridge failed: ${message}` });
    return { output: `本地助理处理失败：${message}`, sessionId: null };
  });
  await deliverReply(session, event, result.output || "（本地助理暂无回复）").catch(() => undefined);
  return result;
}

export const __test__ = {
  assistantMessageKey,
  collectAssistantText,
  latestNewAssistantText,
};
