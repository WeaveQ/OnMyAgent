const EVENT_TYPES = new Set(["log", "status", "assistant_chunk", "assistant", "tool", "error", "exit", "approval_request", "approval_decision", "artifact"]);
const TOOL_DETAIL_PREVIEW_CHARS = 2000;
const TOOL_DESCRIPTION_PREVIEW_CHARS = 160;

function textValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

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

function pushConversationMessage(messages, message) {
  messages.push({ id: nextMessageId(messages), ...message });
}

export function runEventsToConversationMessages(events = []) {
  const messages = [];
  let assistantText = "";
  const toolMessageById = new Map();
  for (const event of Array.isArray(events) ? events : []) {
    const normalized = normalizeRunEvent(event);
    const at = Number(event?.at) || Date.now();
    if (normalized.type === "assistant_chunk") {
      assistantText += normalized.text;
      if (normalized.text) pushConversationMessage(messages, { type: "text", role: "assistant", text: normalized.text, createdAt: at, sourceEventType: normalized.type });
    } else if (normalized.type === "assistant") {
      const text = normalized.text || assistantText.trim();
      if (text) pushConversationMessage(messages, { type: "finish", role: "assistant", text, createdAt: at, sourceEventType: normalized.type });
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
    } else if (normalized.type === "error") {
      pushConversationMessage(messages, { type: "error", role: "system", text: normalized.text, createdAt: at, sourceEventType: normalized.type, category: errorCategoryFromText(normalized.text) });
    } else if (normalized.type === "status") {
      pushConversationMessage(messages, { type: statusMessageTypeFromText(normalized.text), role: "system", text: normalized.text, createdAt: at, sourceEventType: normalized.type });
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
