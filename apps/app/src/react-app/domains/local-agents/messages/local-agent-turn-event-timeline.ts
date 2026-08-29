import type {
  PersonalLocalAgentAcpToolCallUpdate,
  PersonalLocalAgentConversationMessage,
  PersonalLocalAgentRunEvent,
  PersonalLocalAgentToolCall,
} from "../../../../app/lib/desktop";

const ACP_IDENTITY_FIELDS = new Set(["title", "name", "kind", "input", "rawInput", "raw_input"]);
const FINAL_BODY_BOUNDARY_TYPES = new Set([
  "thinking",
  "plan",
  "tool",
  "acp_tool_call",
  "tool_group",
  "approval_request",
  "approval_decision",
]);

function eventTime(event: PersonalLocalAgentRunEvent) {
  return Number(event.at) || Date.now();
}

function eventMessageId(event: PersonalLocalAgentRunEvent, index: number, prefix: string) {
  return event.eventId?.trim() || `${prefix}-${index}-${eventTime(event)}`;
}

function meaningful(value: unknown) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

function mergeAcpUpdate(
  previous: PersonalLocalAgentAcpToolCallUpdate | null | undefined,
  next: PersonalLocalAgentAcpToolCallUpdate | null | undefined,
) {
  const merged: PersonalLocalAgentAcpToolCallUpdate = { ...(previous ?? {}) };
  for (const [key, value] of Object.entries(next ?? {})) {
    if (value === undefined || value === null) continue;
    if (ACP_IDENTITY_FIELDS.has(key) && !meaningful(value) && meaningful(Reflect.get(merged, key))) {
      continue;
    }
    Reflect.set(merged, key, value);
  }
  return merged;
}

function mergeToolCall(
  previous: PersonalLocalAgentToolCall | null | undefined,
  next: PersonalLocalAgentToolCall | null | undefined,
) {
  if (!previous) return next ?? null;
  if (!next) return previous;
  return {
    ...previous,
    ...next,
    name: next.name?.trim() || previous.name,
    kind: next.kind?.trim() || previous.kind,
    description: next.description?.trim() || previous.description,
    input: next.input?.trim() || previous.input,
    output: next.output?.trim() || previous.output,
  };
}

function acpToolId(update: PersonalLocalAgentAcpToolCallUpdate | null | undefined) {
  return String(update?.toolCallId ?? update?.tool_call_id ?? "").trim();
}

function thinkingText(event: PersonalLocalAgentRunEvent) {
  if (event.text.trim()) return event.text;
  return [event.subject, event.description]
    .map((value) => value?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}

/**
 * Build the Local Agent's visible process stream from raw renderer events.
 *
 * Runtime conversation messages intentionally compact repeated updates. That
 * shape is useful for persistence, but it cannot preserve narration that lands
 * between tool calls. The UI already receives the raw events, so presentation
 * uses them to retain the real thinking → tool → narration order without
 * changing ACP/session behavior.
 */
export function localAgentTurnMessagesFromEvents(
  events: readonly PersonalLocalAgentRunEvent[] | null | undefined,
): PersonalLocalAgentConversationMessage[] {
  const messages: PersonalLocalAgentConversationMessage[] = [];
  const toolIndexByKey = new Map<string, number>();
  const approvalIndexById = new Map<string, number>();
  let narrationIndex = -1;
  let thinkingIndex = -1;
  let thinkingKey: string | null = null;
  const hasStructuredThinking = (events ?? []).some((event) => event.type === "thinking");

  const breakNarration = () => {
    narrationIndex = -1;
  };
  const breakThinking = () => {
    thinkingIndex = -1;
    thinkingKey = null;
  };
  const breakProcessSegment = () => {
    breakNarration();
    breakThinking();
  };

  for (const [index, event] of (events ?? []).entries()) {
    const type = event.type === "chunk" ? "assistant_chunk" : event.type;
    const createdAt = eventTime(event);

    if (type === "assistant_chunk") {
      breakThinking();
      if (!event.text) continue;
      const previous = messages[narrationIndex];
      if (previous && narrationIndex === messages.length - 1) {
        messages[narrationIndex] = {
          ...previous,
          text: `${previous.text}${event.text}`,
        };
      } else {
        narrationIndex = messages.length;
        messages.push({
          id: eventMessageId(event, index, "narration"),
          type: "text",
          role: "assistant",
          text: event.text,
          createdAt,
          sourceEventType: "assistant_chunk",
        });
      }
      continue;
    }

    if (type === "thought" && hasStructuredThinking) continue;
    if (type === "thinking" || type === "thought") {
      breakNarration();
      const key = event.msgId?.trim() || "__contiguous__";
      const text = thinkingText(event);
      const status = event.status?.trim() || (type === "thought" ? "thinking" : "thinking");
      const previous = messages[thinkingIndex];
      if (previous && thinkingIndex === messages.length - 1 && thinkingKey === key) {
        const done = /^(done|completed|complete)$/i.test(status);
        messages[thinkingIndex] = {
          ...previous,
          text: done && !text ? previous.text : `${previous.text}${text}`,
          status,
          durationMs: event.durationMs ?? previous.durationMs ?? null,
          startedAt: previous.startedAt ?? event.startedAt ?? null,
        };
      } else if (text || !/^(done|completed|complete)$/i.test(status)) {
        thinkingIndex = messages.length;
        thinkingKey = key;
        messages.push({
          id: eventMessageId(event, index, "thinking"),
          type: "thinking",
          role: "assistant",
          text,
          createdAt,
          sourceEventType: type,
          status,
          msgId: event.msgId ?? null,
          durationMs: event.durationMs ?? null,
          startedAt: event.startedAt ?? null,
        });
      }
      continue;
    }

    if (type === "tool" && event.toolCall) {
      breakProcessSegment();
      const key = `tool:${event.toolCall.id}`;
      const existingIndex = toolIndexByKey.get(key);
      if (existingIndex !== undefined) {
        const previous = messages[existingIndex]!;
        const toolCall = mergeToolCall(previous.toolCall, event.toolCall);
        messages[existingIndex] = {
          ...previous,
          text: event.text.trim() || previous.text,
          status: toolCall?.status ?? previous.status,
          toolCall,
        };
      } else {
        toolIndexByKey.set(key, messages.length);
        messages.push({
          id: eventMessageId(event, index, key),
          type: "tool",
          role: "tool",
          text: event.text,
          createdAt,
          sourceEventType: type,
          status: event.toolCall.status,
          toolCall: event.toolCall,
        });
      }
      continue;
    }

    if (type === "acp_tool_call" && event.update) {
      breakProcessSegment();
      const callId = acpToolId(event.update);
      const key = callId ? `acp:${callId}` : `acp-event:${eventMessageId(event, index, "tool")}`;
      const existingIndex = toolIndexByKey.get(key);
      if (existingIndex !== undefined) {
        const previous = messages[existingIndex]!;
        const update = mergeAcpUpdate(previous.update, event.update);
        messages[existingIndex] = {
          ...previous,
          text: event.text.trim() || previous.text,
          status: String(update.status ?? previous.status ?? "running"),
          update,
        };
      } else {
        toolIndexByKey.set(key, messages.length);
        messages.push({
          id: eventMessageId(event, index, key),
          type: "acp_tool_call",
          role: "tool",
          text: event.text,
          createdAt,
          sourceEventType: type,
          status: String(event.update.status ?? "running"),
          update: event.update,
          msgId: event.msgId ?? null,
        });
      }
      continue;
    }

    if (type === "plan") {
      breakProcessSegment();
      messages.push({
        id: eventMessageId(event, index, "plan"),
        type: "plan",
        role: "assistant",
        text: event.text,
        createdAt,
        sourceEventType: type,
        entries: event.plan?.entries ?? [],
      });
      continue;
    }

    if (type === "approval_request" && event.approval) {
      breakProcessSegment();
      approvalIndexById.set(event.approval.id, messages.length);
      messages.push({
        id: eventMessageId(event, index, `approval:${event.approval.id}`),
        type: "permission",
        role: "system",
        text: event.text,
        createdAt,
        sourceEventType: type,
        approval: event.approval,
      });
      continue;
    }

    if (type === "approval_decision" && event.approval) {
      breakProcessSegment();
      const existingIndex = approvalIndexById.get(event.approval.id);
      if (existingIndex !== undefined) {
        const previous = messages[existingIndex]!;
        messages[existingIndex] = {
          ...previous,
          text: event.text.trim() || previous.text,
          approval: { ...previous.approval, ...event.approval },
        };
      }
      continue;
    }

    if (type === "tips" || type === "error") {
      breakProcessSegment();
      messages.push({
        id: eventMessageId(event, index, type),
        type,
        role: "system",
        text: event.text,
        createdAt,
        sourceEventType: type,
        category: event.category ?? undefined,
        ownership: event.ownership ?? null,
        resolution: event.resolution ?? null,
      });
      continue;
    }

    if ((type === "assistant" || type === "finish") && event.text.trim()) {
      breakProcessSegment();
      messages.push({
        id: eventMessageId(event, index, "finish"),
        type: "finish",
        role: "assistant",
        text: event.text,
        createdAt,
        sourceEventType: type,
        stopReason: event.stopReason ?? null,
        truncated: Boolean(event.truncated),
      });
    }
  }

  return messages;
}

/**
 * Return the last assistant narration segment after the last process boundary.
 * ACP's terminal `assistant` event can contain every chunk from the turn, so it
 * cannot by itself distinguish intermediate narration from the final body.
 * `null` means the event stream has no assistant text; an empty string means
 * the stream proves that no final narration followed the last process step.
 */
export function localAgentFinalBodyFromEvents(
  events: readonly PersonalLocalAgentRunEvent[] | null | undefined,
): string | null {
  let allChunks = "";
  let trailingChunks = "";
  let terminalText = "";
  let sawAssistantText = false;
  let sawProcessBoundary = false;

  for (const event of events ?? []) {
    const type = event.type === "chunk" ? "assistant_chunk" : event.type;
    if (type === "user") {
      allChunks = "";
      trailingChunks = "";
      terminalText = "";
      sawAssistantText = false;
      sawProcessBoundary = false;
      continue;
    }
    if (type === "assistant_chunk") {
      if (!event.text) continue;
      sawAssistantText = true;
      allChunks += event.text;
      trailingChunks += event.text;
      continue;
    }
    if (FINAL_BODY_BOUNDARY_TYPES.has(type)) {
      sawProcessBoundary = true;
      trailingChunks = "";
      continue;
    }
    if ((type === "assistant" || type === "finish") && event.text.trim()) {
      sawAssistantText = true;
      terminalText = event.text;
    }
  }

  if (!sawAssistantText) return null;
  if (!sawProcessBoundary) return terminalText.trim() || allChunks.trim();
  if (trailingChunks.trim()) return trailingChunks.trim();
  if (terminalText.trim() && terminalText.trim() !== allChunks.trim()) {
    return terminalText.trim();
  }
  return "";
}
