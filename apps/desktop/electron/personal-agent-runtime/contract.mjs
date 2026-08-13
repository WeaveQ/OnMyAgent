import { normalizeContextUsagePayload } from "./context-usage.mjs";

const EVENT_TYPES = new Set(["log", "status", "assistant_chunk", "assistant", "finish", "tool", "acp_tool_call", "task_permission_decision", "error", "exit", "approval_request", "approval_decision", "artifact", "plan", "thinking", "tips", "user"]);
const TOOL_DETAIL_PREVIEW_CHARS = 2000;
const TOOL_DESCRIPTION_PREVIEW_CHARS = 160;

function textValue(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/**
 * Detect Grok-style concatenated skill inventory dumps (SKILL.md JSON walls)
 * so they never land as assistant transcript body.
 */
function looksLikeSkillCatalogDump(text) {
  const s = String(text ?? "").trim();
  if (s.length < 48 || !s.includes("{")) return false;
  const skillMd = (s.match(/SKILL\.md/gi) || []).length;
  const scope = (s.match(/"scope"\s*:\s*"(bundled|user|project|workspace)"/g) || []).length;
  const meta = (s.match(/"_meta"\s*:/g) || []).length;
  const names = (s.match(/"name"\s*:\s*"/g) || []).length;
  if (skillMd >= 2 && (scope + meta) >= 2) return true;
  if (skillMd >= 1 && names >= 3 && meta >= 1 && s.startsWith("{")) return true;
  return false;
}

function stripSkillCatalogDump(text) {
  const s = String(text ?? "");
  if (!s.trim()) return "";
  if (looksLikeSkillCatalogDump(s)) {
    const prose = s
      .replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (prose.length < 12) return "";
    if (!/[\u4e00-\u9fff]/.test(prose) && prose.split(/\s+/).filter((w) => /[A-Za-z]{3,}/.test(w)).length < 3) {
      return "";
    }
  }
  const leading = s.match(/^(\s*(?:\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\})+)/);
  if (leading && looksLikeSkillCatalogDump(leading[1] ?? "")) {
    return s.slice(leading[0].length).trimStart();
  }
  return s.trim();
}

/**
 * @param {Record<string, any>} [event]
 * @returns {Record<string, any> & { type: string, text: string, stopReason?: string | null, truncated?: boolean }}
 */
export function normalizeRunEvent(event = {}) {
  const rawType = String(event.type ?? "log").trim();
  const rawText = event.text === undefined || event.text === null ? "" : String(event.text);
  let type = rawType;
  let text = textValue(rawText);

  if (rawType === "chunk" || rawType === "assistant_chunk") {
    type = "assistant_chunk";
    text = rawText;
  }
  if (rawType === "log" && /^assistant_chunk>/.test(rawText)) {
    type = "assistant_chunk";
    text = rawText.replace(/^assistant_chunk>[ \t]?/, "");
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
    terminationConfirmed: result.terminationConfirmed === true,
    exitConfirmed: result.exitConfirmed === true,
    childExitConfirmed: result.childExitConfirmed === true,
    childState: textValue(result.childState) || null,
    exitCode: Number.isInteger(result.exitCode) ? result.exitCode : null,
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

function acpToolCallId(update) {
  return textValue(update?.tool_call_id ?? update?.toolCallId ?? update?.id);
}

const ACP_TOOL_IDENTITY_FIELDS = new Set([
  "title",
  "name",
  "kind",
  "input",
  "rawInput",
  "raw_input",
]);

function isEmptyAcpToolIdentityValue(value) {
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return Boolean(value && typeof value === "object" && Object.keys(value).length === 0);
}

export function mergeAcpToolCallUpdate(previous, next) {
  const merged = { ...(previous ?? {}) };
  for (const [key, value] of Object.entries(next ?? {})) {
    // Incremental ACP updates frequently omit the original title/input. A
    // null or empty-schema placeholder must not erase useful data from the
    // start event. Status/output remain allowed to carry empty values because
    // those fields describe the new update rather than tool identity.
    if (value === undefined || value === null) continue;
    if (
      ACP_TOOL_IDENTITY_FIELDS.has(key)
      && isEmptyAcpToolIdentityValue(value)
      && !isEmptyAcpToolIdentityValue(merged[key])
    ) {
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function acpToolConversationEntry(update, normalized, at, identity) {
  const callId = acpToolCallId(update);
  const status = textValue(update?.status ?? update?.state) || "running";
  return {
    id: `acp-tool-${identity}`,
    type: "acp_tool_call",
    role: "tool",
    text: normalized.text
      || textValue(update?.title ?? update?.kind)
      || (status === "failed" ? callId : ""),
    createdAt: at,
    sourceEventType: normalized.type,
    status,
    update,
    at,
  };
}

export function runEventsToConversationMessages(events = []) {
  const messages = [];
  let assistantText = "";
  // Merge streaming chunks into one live assistant message per turn. A final
  // `finish` event closes the turn so the next prompt starts a fresh message.
  let liveAssistantIndex = -1;
  let liveMsgSeq = 0;
  const toolMessageById = new Map();
  // ACP does not require msg_id on tool updates. Codex ACP commonly emits a
  // start + completed pair with only tool_call_id; keep a turn-wide index so
  // the pair updates one card instead of creating duplicate/empty rows.
  const acpToolMessageById = new Map();
  // ACP tool_call_id/msg_id values are only turn-scoped. Keep an explicit,
  // deterministic turn namespace so historical cards never reuse React IDs
  // when a provider starts counting from tool-1 again on the next prompt.
  let acpTurnSeq = 0;
  let acpTurnIdentity = "turn-0";
  const acpTurnIdentityCounts = new Map();
  let acpToolEventSeq = 0;
  const closeAssistantTurn = () => {
    liveAssistantIndex = -1;
    assistantText = "";
    liveMsgSeq += 1;
  };
  for (const event of Array.isArray(events) ? events : []) {
    const normalized = normalizeRunEvent(event);
    const at = Number(event?.at) || Date.now();
    if (normalized.type === "user") {
      // A user prompt event (recorded by the runtime before dispatching to the
      // adapter). Close any in-flight assistant turn so the user message starts
      // a fresh bubble, then emit it as a top-level user text message. This is
      // what makes channel-initiated runs (Telegram/Discord/Weixin/Feishu) —
      // which have no renderer-side optimistic user input — show the user's
      // message in the Studio conversation view alongside the agent reply.
      if (liveAssistantIndex !== -1) closeAssistantTurn();
      // Tool call identifiers are only unique inside one turn. Providers may
      // reuse values such as `tool-1` on the next prompt, so do not merge a
      // new turn's tool cards into historical groups.
      toolMessageById.clear();
      acpToolMessageById.clear();
      acpTurnSeq += 1;
      const turnIdentityBase = Number(event?.at) > 0
        ? `turn-${Number(event.at)}`
        : `turn-sequence-${acpTurnSeq}`;
      const turnIdentityCount = (acpTurnIdentityCounts.get(turnIdentityBase) ?? 0) + 1;
      acpTurnIdentityCounts.set(turnIdentityBase, turnIdentityCount);
      acpTurnIdentity = turnIdentityCount === 1
        ? turnIdentityBase
        : `${turnIdentityBase}-${turnIdentityCount}`;
      if (normalized.text) {
        pushConversationMessage(messages, {
          type: "text",
          role: "user",
          text: normalized.text,
          createdAt: at,
          sourceEventType: normalized.type,
        });
      }
    } else if (normalized.type === "assistant_chunk") {
      if (!normalized.text) continue;
      assistantText += normalized.text;
      const displayText = stripSkillCatalogDump(assistantText);
      // Keep buffering raw chunks, but only surface non-dump text in the bubble.
      if (!displayText) continue;
      if (liveAssistantIndex === -1) {
        liveAssistantIndex = messages.length;
        pushConversationMessage(messages, {
          type: "text",
          role: "assistant",
          text: displayText,
          createdAt: at,
          sourceEventType: normalized.type,
          msgId: `assistant-${liveMsgSeq}`,
        });
      } else {
        const previous = messages[liveAssistantIndex];
        messages[liveAssistantIndex] = { ...previous, text: displayText, createdAt: at };
      }
    } else if (normalized.type === "assistant" || normalized.type === "finish") {
      const text = stripSkillCatalogDump(normalized.text || assistantText.trim());
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
      acpToolEventSeq += 1;
      const callId = acpToolCallId(update);
      const indexed = callId ? acpToolMessageById.get(callId) : null;
      if (indexed) {
        const previousGroup = messages[indexed.messageIndex];
        const previousCall = previousGroup?.toolCalls?.[indexed.callIndex];
        if (previousGroup?.type === "tool_group" && previousCall) {
          const mergedUpdate = mergeAcpToolCallUpdate(previousCall.update, update);
          const nextCalls = [...previousGroup.toolCalls];
          nextCalls[indexed.callIndex] = {
            ...previousCall,
            text: normalized.text || previousCall.text,
            createdAt: at,
            status: textValue(mergedUpdate?.status ?? mergedUpdate?.state) || previousCall.status,
            update: mergedUpdate,
            at,
          };
          messages[indexed.messageIndex] = {
            ...previousGroup,
            toolCalls: nextCalls,
            createdAt: at,
          };
          continue;
        }
      }
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
      const entryIdentity = callId
        ? `${acpTurnIdentity}-call-${callId}`
        : `${acpTurnIdentity}-event-${acpToolEventSeq}`;
      const entry = acpToolConversationEntry(update, normalized, at, entryIdentity);
      if (existingIndex >= 0) {
        const previous = messages[existingIndex];
        const nextCalls = [...previous.toolCalls];
        const dupIndex = callId
          ? nextCalls.findIndex((call) => acpToolCallId(call.update) === callId)
          : -1;
        if (dupIndex >= 0) {
          const previousCall = nextCalls[dupIndex];
          nextCalls[dupIndex] = {
            ...previousCall,
            text: normalized.text || previousCall.text,
            createdAt: at,
            status: entry.status || previousCall.status,
            update: mergeAcpToolCallUpdate(previousCall.update, update),
            at,
          };
        } else {
          nextCalls.push(entry);
        }
        messages[existingIndex] = { ...previous, toolCalls: nextCalls, createdAt: at };
        if (callId) {
          acpToolMessageById.set(callId, {
            messageIndex: existingIndex,
            callIndex: dupIndex >= 0 ? dupIndex : nextCalls.length - 1,
          });
        }
      } else {
        pushConversationMessage(messages, {
          ...(msgId
            ? { id: `tool-group-${acpTurnIdentity}-message-${msgId}` }
            : callId
              ? { id: `tool-group-${acpTurnIdentity}-call-${callId}` }
              : { id: `tool-group-${acpTurnIdentity}-event-${acpToolEventSeq}` }),
          type: "tool_group",
          role: "tool",
          text: normalized.text || entry.text,
          createdAt: at,
          sourceEventType: normalized.type,
          msgId,
          toolCalls: [entry],
        });
        if (callId) {
          acpToolMessageById.set(callId, {
            messageIndex: messages.length - 1,
            callIndex: 0,
          });
        }
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
