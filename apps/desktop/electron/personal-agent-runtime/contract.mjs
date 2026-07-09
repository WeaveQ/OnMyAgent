import { normalizeContextUsagePayload } from "./context-usage.mjs";

const EVENT_TYPES = new Set(["log", "status", "assistant_chunk", "assistant", "finish", "tool", "acp_tool_call", "error", "exit", "approval_request", "approval_decision", "artifact", "plan", "thinking", "tips"]);
const TOOL_DETAIL_PREVIEW_CHARS = 2000;
const TOOL_DESCRIPTION_PREVIEW_CHARS = 160;

function textValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/**
 * @param {Record<string, any>} [event]
 * @returns {Record<string, any> & { type: string, text: string, stopReason?: string | null, truncated?: boolean }}
 */
export function normalizeRunEvent(event = {}) {
  const rawType = String(event.type ?? "log").trim();
  let type = rawType;
  let text = textValue(event.text);

  if (rawType === "chunk") type = "assistant_chunk";
  if (rawType === "log" && /^assistant_chunk>\s*/.test(text)) {
    type = "assistant_chunk";
    text = text.replace(/^assistant_chunk>\s*/, "").trim();
  }
  if (rawType === "log" && /^tool_(?:start|result|update)>\s*/.test(text)) {
    type = "tool";
  }
  if (!EVENT_TYPES.has(type)) type = "log";

  return {
    ...event,
    type,
    text,
  };
}

export function appendContractEvent(events, event) {
  const normalized = normalizeRunEvent(event);
  events.push({ ...normalized, at: Date.now() });
  return normalized;
}

export function normalizeAdapterResult(result = {}) {
  const output = textValue(result.output);
  if (!output) throw new Error("Local agent adapter returned no assistant output");
  return {
    output,
    command: textValue(result.command) || "local agent harness session",
    connectionMode: textValue(result.connectionMode) || null,
    pid: Number.isFinite(result.pid) ? result.pid : null,
    providerSessionId: result.providerSessionId ?? result.sessionId ?? null,
    resumeKey: Object.prototype.hasOwnProperty.call(result, "resumeKey")
      ? result.resumeKey
      : (result.providerSessionId ?? result.sessionId ?? null),
    metadata: result.metadata ?? null,
    workdir: result.workdir ?? null,
  };
}

function nextMessageId(messages) {
  return `msg-${messages.length + 1}`;
}

function toolStatusFromText(text) {
  const lower = text.toLowerCase();
  if (/failed|error|exit_code"?\s*:\s*(?!0)\d+/.test(lower)) return "failed";
  if (/complete|completed|success|done/.test(lower)) return "completed";
  return "running";
}

function previewText(value, limit = TOOL_DETAIL_PREVIEW_CHARS) {
  const text = textValue(value);
  if (!text) return { text: "", truncated: false };
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}\n...`, truncated: true };
}

function previewDescription(value) {
  return previewText(value, TOOL_DESCRIPTION_PREVIEW_CHARS).text.replace(/\s+/g, " ").trim();
}

function formatJsonPreview(value) {
  if (!value || typeof value !== "object") return previewText(value);
  try {
    return previewText(JSON.stringify(value, null, 2));
  } catch {
    return previewText(String(value));
  }
}

function normalizeToolStatus(value, fallbackText = "") {
  const lower = String(value ?? "").toLowerCase();
  if (/failed|error|exit_code"?\s*:\s*(?!0)\d+/.test(lower)) return "failed";
  if (/complete|completed|success|succeeded|done/.test(lower)) return "completed";
  if (/cancel|canceled|cancelled/.test(lower)) return "cancelled";
  if (/pending|confirm/.test(lower)) return "pending";
  if (lower) return "running";
  return toolStatusFromText(fallbackText);
}

function parseLegacyToolText(text) {
  const trimmed = textValue(text);
  const acp = trimmed.match(/^acp_tool_call(?:_update)?>\s*([\s\S]+)$/i);
  if (acp) {
    const payload = textValue(acp[1]);
    try {
      const data = JSON.parse(payload);
      const rawInput = data?.rawInput || data?.raw_input || data?.input || {};
      const name = textValue(data?.title || data?.name || data?.kind || rawInput?.tool_name || rawInput?.command || "tool");
      const description = previewDescription(rawInput?.command || rawInput?.file_path || rawInput?.path || rawInput?.pattern || data?.description || data?.kind);
      const id = textValue(data?.tool_call_id || data?.id);
      if (!id) return null;
      const output = Array.isArray(data?.content)
        ? data.content.map((item) => textValue(item?.content?.text || item?.text)).filter(Boolean).join("\n")
        : textValue(data?.output || data?.result || data?.rawOutput);
      const inputPreview = rawInput && Object.keys(rawInput).length ? formatJsonPreview(rawInput) : { text: "", truncated: false };
      const outputPreview = previewText(output);
      return {
        id,
        name,
        status: data?.status || data?.state || "running",
        description,
        input: inputPreview.text,
        output: outputPreview.text,
        inputTruncated: inputPreview.truncated,
        outputTruncated: outputPreview.truncated,
      };
    } catch {
      return null;
    }
  }
  const start = trimmed.match(/^tool_start>\s*([^:]+):\s*([\s\S]+)$/i);
  if (start) {
    const name = textValue(start[1]);
    const command = textValue(start[2]);
    const commandPreview = previewText(command);
    return { id: `${name}:${command}`, name, status: "running", description: previewDescription(command), input: commandPreview.text, inputTruncated: commandPreview.truncated };
  }
  return null;
}

function normalizeToolCall(value, text) {
  const source = value && typeof value === "object" ? value : {};
  const legacy = parseLegacyToolText(text);
  if (!legacy && !Object.keys(source).length) return null;
  const name = textValue(source.name || source.title);
  const description = previewDescription(source.description || source.command || source.path || source.pattern);
  const inputPreview = previewText(source.input);
  const outputPreview = previewText(source.output);
  const id = textValue(source.id || source.callId || source.tool_call_id || legacy?.id);
  if (!id) return null;
  return {
    id,
    name: name || legacy?.name || "tool",
    kind: textValue(source.kind),
    status: normalizeToolStatus(source.status || legacy?.status, text),
    description: description || legacy?.description || "",
    input: inputPreview.text || legacy?.input || "",
    output: outputPreview.text || legacy?.output || "",
    inputTruncated: inputPreview.truncated || legacy?.inputTruncated || false,
    outputTruncated: outputPreview.truncated || legacy?.outputTruncated || false,
  };
}

function errorCategoryFromText(text) {
  const lower = text.toLowerCase();
  if (/permission|refused|denied|拒绝/.test(lower)) return "permission";
  if (/auth|login|认证|登录/.test(lower)) return "auth";
  if (/network|resolve|fetch|timeout|超时/.test(lower)) return "network";
  return "provider";
}

function statusMessageTypeFromText(text) {
  if (/^acp_available_commands>/.test(text)) return "available_commands";
  if (/^acp_(?:context_usage|usage_update)>/.test(text)) return "context_usage";
  return "agent_status";
}

function parseAcpJsonPayload(text, prefixRe) {
  if (typeof text !== "string") return null;
  const stripped = text.replace(prefixRe, "").trim();
  if (!stripped) return null;
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

function pushConversationMessage(messages, message) {
  messages.push({ id: nextMessageId(messages), ...message });
}

export function runEventsToConversationMessages(events = []) {
  const messages = [];
  let assistantText = "";
  // Merge streaming chunks into one live assistant message per turn. A final
  // `finish` event closes the turn so the next prompt starts a fresh message.
  let liveAssistantIndex = -1;
  let liveMsgSeq = 0;
  const toolMessageById = new Map();
  const closeAssistantTurn = () => {
    liveAssistantIndex = -1;
    assistantText = "";
    liveMsgSeq += 1;
  };
  for (const event of Array.isArray(events) ? events : []) {
    const normalized = normalizeRunEvent(event);
    const at = Number(event?.at) || Date.now();
    if (normalized.type === "assistant_chunk") {
      if (!normalized.text) continue;
      assistantText += normalized.text;
      if (liveAssistantIndex === -1) {
        liveAssistantIndex = messages.length;
        pushConversationMessage(messages, {
          type: "text",
          role: "assistant",
          text: assistantText,
          createdAt: at,
          sourceEventType: normalized.type,
          msgId: `assistant-${liveMsgSeq}`,
        });
      } else {
        const previous = messages[liveAssistantIndex];
        messages[liveAssistantIndex] = { ...previous, text: assistantText, createdAt: at };
      }
    } else if (normalized.type === "assistant" || normalized.type === "finish") {
      const text = normalized.text || assistantText.trim();
      if (text) {
        pushConversationMessage(messages, {
          type: "finish",
          role: "assistant",
          text,
          createdAt: at,
          sourceEventType: normalized.type,
          stopReason: normalized.stopReason ?? null,
          truncated: Boolean(normalized.truncated),
        });
      }
      closeAssistantTurn();
    } else if (normalized.type === "tool") {
      if (/^item_(?:start|done)>/i.test(normalized.text)) continue;
      const rawToolCall = event?.toolCall;
      if (!rawToolCall && /^tool_end>/i.test(normalized.text)) continue;
      const toolCall = normalizeToolCall(rawToolCall, normalized.text);
      if (!toolCall) continue;
      const key = toolCall.id || normalized.text;
      const existingIndex = toolMessageById.get(key);
      const mergedText = [toolCall.name, toolCall.description].filter(Boolean).join(" ").trim() || normalized.text;
      const nextMessage = {
        type: "tool",
        role: "tool",
        text: mergedText,
        createdAt: at,
        sourceEventType: normalized.type,
        status: toolCall.status,
        toolCall,
      };
      if (existingIndex !== undefined) {
        const previous = messages[existingIndex];
        messages[existingIndex] = {
          ...previous,
          ...nextMessage,
          id: previous.id,
          toolCall: {
            ...previous.toolCall,
            ...toolCall,
            input: toolCall.input || previous.toolCall?.input || "",
            output: toolCall.output || previous.toolCall?.output || "",
          },
        };
      } else {
        toolMessageById.set(key, messages.length);
        pushConversationMessage(messages, nextMessage);
      }
    } else if (normalized.type === "approval_request") {
      const approval = "approval" in normalized ? normalized.approval : null;
      pushConversationMessage(messages, { type: "permission", role: "system", text: normalized.text, createdAt: at, sourceEventType: normalized.type, approval: approval ?? null });
    } else if (normalized.type === "approval_decision") {
      const approval = "approval" in normalized ? normalized.approval : null;
      const approvalId = approval && typeof approval === "object" ? String(approval.id ?? "") : "";
      // Derive the decision label. Prefer explicit approval.decision, then a
      // "storedApprovalKey" marker (auto-accepted from remembered decisions),
      // then parse "<kind>: <decision>" out of the event text.
      let decision = approval && typeof approval === "object" ? String(approval.decision ?? "").trim() : "";
      if (!decision && normalized.storedApprovalKey) decision = "acceptForSession";
      if (!decision) {
        const match = /:\s*([a-zA-Z_]+)(?:\s*\(|\s*$)/.exec(String(normalized.text ?? ""));
        if (match) decision = match[1];
      }
      // Attach decision back onto the existing permission message so the
      // host-status permission view-model can count it as approved/denied.
      let targetIndex = -1;
      if (approvalId) {
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          const message = messages[i];
          if (message?.type === "permission" && message?.approval?.id === approvalId) {
            targetIndex = i;
            break;
          }
        }
      }
      if (targetIndex >= 0) {
        const previous = messages[targetIndex];
        const mergedApproval = { ...(previous.approval ?? {}), ...(approval ?? {}), decision: decision || previous.approval?.decision || "" };
        messages[targetIndex] = { ...previous, approval: mergedApproval, createdAt: at, sourceEventType: normalized.type };
      } else if (approval) {
        pushConversationMessage(messages, {
          type: "permission",
          role: "system",
          text: normalized.text,
          createdAt: at,
          sourceEventType: normalized.type,
          approval: { ...approval, decision: decision || approval.decision || "" },
        });
      }
    } else if (normalized.type === "plan") {
      const entries = Array.isArray(event?.plan?.entries)
        ? event.plan.entries
        : Array.isArray(event?.entries)
          ? event.entries
          : [];
      pushConversationMessage(messages, {
        type: "plan",
        role: "system",
        text: normalized.text,
        createdAt: at,
        sourceEventType: normalized.type,
        entries,
      });
    } else if (normalized.type === "thinking") {
      const msgId = event?.msgId ?? normalized.msgId ?? null;
      const status = String(event?.status ?? normalized.status ?? "thinking");
      const durationMs = typeof event?.durationMs === "number" ? event.durationMs : null;
      const startedAt = typeof event?.startedAt === "number" ? event.startedAt : null;
      // Merge streaming chunks by msgId. Same-msgId chunks concatenate into one
      // message; the status:"done" boundary freezes the final text/duration.
      let existingIndex = -1;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i];
        if (message?.type === "thinking" && (message.msgId ?? null) === msgId) {
          existingIndex = i;
          break;
        }
      }
      if (existingIndex >= 0) {
        const previous = messages[existingIndex];
        const nextText = status === "done" ? previous.text : previous.text + (normalized.text || "");
        messages[existingIndex] = {
          ...previous,
          text: nextText,
          status,
          durationMs: durationMs ?? previous.durationMs ?? null,
          startedAt: startedAt ?? previous.startedAt ?? null,
          createdAt: at,
        };
      } else {
        pushConversationMessage(messages, {
          type: "thinking",
          role: "assistant",
          text: normalized.text || "",
          createdAt: at,
          sourceEventType: normalized.type,
          status,
          msgId,
          durationMs,
          startedAt,
        });
      }
    } else if (normalized.type === "acp_tool_call") {
      const msgId = event?.msgId ?? normalized.msgId ?? null;
      const update = event?.update ?? normalized.update ?? null;
      if (!update) continue;
      let existingIndex = -1;
      if (msgId) {
        for (let i = messages.length - 1; i >= 0; i -= 1) {
          const message = messages[i];
          if (message?.type === "tool_group" && (message.msgId ?? null) === msgId) {
            existingIndex = i;
            break;
          }
          // Break the run if a non-tool_group message with different type/role interrupts.
          if (message?.type !== "tool_group") break;
        }
      }
      const entry = { update, at };
      if (existingIndex >= 0) {
        const previous = messages[existingIndex];
        const nextCalls = [...previous.toolCalls];
        const callId = update?.tool_call_id ?? update?.toolCallId ?? null;
        const dupIndex = callId
          ? nextCalls.findIndex((c) => (c.update?.tool_call_id ?? c.update?.toolCallId ?? null) === callId)
          : -1;
        if (dupIndex >= 0) nextCalls[dupIndex] = { ...nextCalls[dupIndex], update: { ...nextCalls[dupIndex].update, ...update }, at };
        else nextCalls.push(entry);
        messages[existingIndex] = { ...previous, toolCalls: nextCalls, createdAt: at };
      } else {
        pushConversationMessage(messages, {
          type: "tool_group",
          role: "tool",
          text: normalized.text || "",
          createdAt: at,
          sourceEventType: normalized.type,
          msgId,
          toolCalls: [entry],
        });
      }
    } else if (normalized.type === "tips") {
      pushConversationMessage(messages, {
        type: "tips",
        role: "system",
        text: normalized.text,
        createdAt: at,
        sourceEventType: normalized.type,
        category: event?.category ?? normalized.category ?? null,
        ownership: event?.ownership ?? normalized.ownership ?? "unknown",
        resolution: event?.resolution ?? normalized.resolution ?? null,
      });
    } else if (normalized.type === "error") {
      pushConversationMessage(messages, { type: "error", role: "system", text: normalized.text, createdAt: at, sourceEventType: normalized.type, category: errorCategoryFromText(normalized.text) });
    } else if (normalized.type === "status") {
      const kind = statusMessageTypeFromText(normalized.text);
      const message = { type: kind, role: "system", text: normalized.text, createdAt: at, sourceEventType: normalized.type };
      if (kind === "context_usage") {
        const payload = parseAcpJsonPayload(normalized.text, /^acp_(?:context_usage|usage_update)>\s*/);
        const usage = normalizeContextUsagePayload(payload, normalized.model ?? event?.model ?? null);
        if (usage) message.contextUsage = usage;
      } else if (kind === "available_commands") {
        const payload = parseAcpJsonPayload(normalized.text, /^acp_available_commands>\s*/);
        if (Array.isArray(payload)) message.commands = payload;
        else if (payload && Array.isArray(payload.commands)) message.commands = payload.commands;
      }
      pushConversationMessage(messages, message);
    }
  }
  return messages;
}

export function userFacingError(error) {
  if (!error) return "本地 Agent 执行失败。";
  if (error instanceof Error) return error.message || "本地 Agent 执行失败。";
  return String(error || "本地 Agent 执行失败。");
}

export const CONTRACT_EVENT_TYPES = [...EVENT_TYPES];
