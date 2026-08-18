// AssistantBridge: routes an IM chat bound to the `onmyagent` pseudo-agent to
// the desktop Assistant tab through the same canonical primary-runtime API as
// the renderer. Runtime selection belongs to the workspace and the persisted
// product session remains sticky across OpenCode/Grok switches and restarts.
//
// Product exception (Architecture Dual Runtime): IM「本地助理」must appear in
// the desktop assistant tab, so this bridge reuses the server-owned product
// session. It never writes an OpenCode/ACP native store from Electron. Do not
// also start a Personal run for the same chat.
// This is a strictly additive dispatch path: only chats whose bound agent has
// provider `onmyagent-assistant` reach this module. Every other agent keeps
// using the ACP runtime exactly as before (no behavior change for codex/claude/
// opencode/etc.).
import path from "node:path";

const POLL_INTERVAL_MS = 900;
const POLL_TIMEOUT_MS = 180_000;

function assistantMessageKey(message) {
  const id = String(message?.id ?? "").trim();
  if (id) return `id:${id}`;
  const role = String(message?.role ?? "").toLowerCase();
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
  const role = String(message?.role ?? "").toLowerCase();
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
    // `messages.complete` only means the history page was fully read; it is
    // not a turn-terminal signal. Wait for the canonical message projection
    // to carry completedAt so a streaming first chunk is never sent as the
    // final channel reply.
    if (message?.completedAt === undefined && !message?.error) continue;
    const text = collectAssistantText(message);
    if (text) return text;
  }
  return "";
}

async function pollAssistantText(client, workspaceId, sessionId, existingKeys, appendLog) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let pollCount = 0;
  while (Date.now() < deadline) {
    const messagesResult = await client.messages(workspaceId, sessionId);
    const output = latestNewAssistantText(messagesResult.messages, existingKeys);
    if (output.trim()) return output;
    pollCount += 1;
    if (pollCount === 1 || pollCount % 10 === 0) {
      appendLog?.({
        type: "log",
        text: `assistant-bridge: waiting polls=${pollCount} messages=${messagesResult.messages.length} complete=${messagesResult.complete}`,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("本地助理会话超时未返回回复");
}

function normalizedDirectory(value) {
  const resolved = path.resolve(String(value ?? "").trim());
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function createCanonicalRuntimeClient({ baseUrl, token, fetchImpl = globalThis.fetch }) {
  const request = async (pathname, init = {}) => {
    const response = await fetchImpl(new URL(pathname, `${baseUrl.replace(/\/$/, "")}/`), {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = typeof payload?.error?.code === "string" ? payload.error.code : "primary_runtime_request_failed";
      const error = Object.assign(
        new Error(typeof payload?.error?.message === "string" ? payload.error.message : code),
        { code, status: response.status },
      );
      throw error;
    }
    return payload;
  };
  const sessionPath = (workspaceId, sessionId) =>
    `/workspace/${encodeURIComponent(workspaceId)}/runtime-sessions/${encodeURIComponent(sessionId)}`;
  return {
    workspaces: () => request("/workspaces"),
    create: (workspaceId) => request(
      `/workspace/${encodeURIComponent(workspaceId)}/runtime-sessions`,
      { method: "POST", body: JSON.stringify({ profile: { kind: "assistant" } }) },
    ),
    get: (workspaceId, sessionId) => request(sessionPath(workspaceId, sessionId)),
    prompt: (workspaceId, sessionId, text) => request(
      `${sessionPath(workspaceId, sessionId)}/prompt`,
      { method: "POST", body: JSON.stringify({ text }) },
    ),
    messages: (workspaceId, sessionId) => request(
      `${sessionPath(workspaceId, sessionId)}/messages`,
    ),
  };
}

async function resolveWorkspaceId(client, workspaceRoot) {
  const response = await client.workspaces();
  const target = normalizedDirectory(workspaceRoot);
  const matches = (response.items ?? []).filter((workspace) =>
    typeof workspace?.path === "string"
    && normalizedDirectory(workspace.path) === target);
  if (matches.length !== 1 || typeof matches[0]?.id !== "string") {
    throw new Error("OnMyAgent workspace is unavailable or ambiguous for this channel");
  }
  return matches[0].id;
}

/**
 * @param {object} input
 * @param {object} [input.runtimeConnection] - OnMyAgent server base URL and client token
 * @param {string} input.workspaceRoot
 * @param {string} input.chatId
 * @param {string} input.text
 * @param {() => Promise<string|null>} [input.readSessionId] - returns persisted product session id for this chat
 * @param {(id: string) => Promise<void>} [input.writeSessionId] - persists the product session id for this chat
 * @param {Function} [input.createClient] - injectable canonical client for tests
 * @param {(entry: { type: string, text: string }) => void} [input.appendLog] - optional structured logger from the channel service
 */
export async function runAssistantTurn(input) {
  const {
    runtimeConnection,
    workspaceRoot,
    chatId,
    text,
    readSessionId,
    writeSessionId,
    createClient = createCanonicalRuntimeClient,
    appendLog,
  } = input;

  const baseUrl = runtimeConnection?.onmyagentServerBaseUrl;
  const token = runtimeConnection?.onmyagentServerToken;
  appendLog?.({ type: "log", text: `assistant-bridge: canonical connection available=${Boolean(baseUrl && token)}` });
  if (!baseUrl || !token) {
    throw new Error("OnMyAgent 主运行时连接不可用（assistant bridge）。");
  }
  const directory = String(workspaceRoot ?? "").trim();
  if (!directory) throw new Error("OnMyAgent workspace is unavailable for this channel");
  const client = createClient({ baseUrl, token });
  const workspaceId = await resolveWorkspaceId(client, directory);

  let sessionId = String((typeof readSessionId === "function" ? await readSessionId() : null) ?? "").trim();
  if (sessionId) {
    try {
      const existing = await client.get(workspaceId, sessionId);
      if (normalizedDirectory(existing.session?.cwd) !== normalizedDirectory(directory)) {
        throw new Error("runtime session workspace mismatch");
      }
      appendLog?.({ type: "log", text: "assistant-bridge: resumed sticky runtime session" });
    } catch (error) {
      if (error?.status !== 404 && error?.code !== "runtime_session_binding_not_found") throw error;
      appendLog?.({ type: "log", text: `assistant-bridge: stale session ${sessionId}, recreating` });
      sessionId = "";
    }
  }
  if (!sessionId) {
    appendLog?.({ type: "log", text: "assistant-bridge: creating selected runtime session" });
    const created = await client.create(workspaceId);
    sessionId = created.session?.productSessionId;
    if (!sessionId) throw new Error("OnMyAgent created a runtime session without an id");
    if (typeof writeSessionId === "function") await writeSessionId(sessionId);
  }

  const before = await client.messages(workspaceId, sessionId);
  const existingKeys = new Set(before.messages.map((message) => assistantMessageKey(message)).filter(Boolean));

  appendLog?.({ type: "log", text: "assistant-bridge: prompting selected runtime session" });
  await client.prompt(workspaceId, sessionId, text);

  const output = await pollAssistantText(client, workspaceId, sessionId, existingKeys, appendLog);
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
 * the desktop Assistant tab's selected primary runtime and hands the reply text
 * back to the caller via `deliverReply` (each channel sends replies differently).
 *
 * @param {object} deps
 * @param {object} deps.runtime - desktop runtime (provides getPrimaryRuntimeConnection)
 * @param {object} deps.store - channel store (provides writeChatSetting)
 * @param {object} deps.session - channel session
 * @param {object} deps.event - inbound message event ({ chatId, senderId, text })
 * @param {string} deps.platformLabel - platform name for log/error prefixes
 * @param {(session: object, chatId: string) => Promise<object|null>} deps.readChatSetting
 * @param {(session: object, event: object, text: string) => Promise<void>} deps.deliverReply
 * @param {(entry: { type: string, text: string }) => void} [deps.appendLog]
 * @param {Function} [deps.createClient] - injectable canonical client for tests
 * @returns {Promise<{ output: string, sessionId: string|null }>}
 */
export async function runAssistantBridgeTurn(deps) {
  const { runtime, store, session, event, platformLabel, readChatSetting, deliverReply, appendLog } = deps;
  const connection = typeof runtime?.getPrimaryRuntimeConnection === "function"
    ? await runtime.getPrimaryRuntimeConnection()
    : null;
  const result = await runAssistantTurn({
    runtimeConnection: connection,
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
    createClient: deps.createClient,
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
