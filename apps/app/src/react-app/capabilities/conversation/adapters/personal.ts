/**
 * Pure personal-runtime adapters: run events / conversationMessages → ConversationItemVM.
 * Host UI (timeline-messages) reuses the intermediate message mapping for rich tool/plan cards.
 */

import type { ConversationItemKind, ConversationItemVM } from "../item-types";
import {
  looksLikeSkillCatalogDump,
  stripSkillCatalogDump,
} from "../assistant-text-sanitize";

/** Minimal personal run event shape used by the adapter (duck-typed). */
export type PersonalAdapterRunEvent = {
  type: string;
  text: string;
  at: number;
  status?: string | null;
  category?: string | null;
  ownership?: string | null;
  resolution?: { target?: string; kind?: string; message?: string } | null;
  msgId?: string | null;
  durationMs?: number | null;
  startedAt?: number | null;
  toolCall?: Record<string, unknown> | null;
  update?: Record<string, unknown> | null;
  approval?: Record<string, unknown> | null;
  plan?: { entries?: unknown[] } | null;
  data?: Record<string, unknown> | null;
};

/** Intermediate message shape aligned with PersonalLocalAgentConversationMessage. */
export type PersonalAdapterMessage = {
  id: string;
  type: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  createdAt: number;
  sourceEventType?: string;
  status?: string;
  category?: string;
  ownership?: string | null;
  resolution?: { target?: string; kind?: string; message?: string } | null;
  msgId?: string | null;
  durationMs?: number | null;
  startedAt?: number | null;
  toolCall?: Record<string, unknown> | null;
  update?: Record<string, unknown> | null;
  approval?: Record<string, unknown> | null;
  entries?: unknown[];
  toolCalls?: PersonalAdapterMessage[];
};

export type PersonalAdapterRun = {
  events?: PersonalAdapterRunEvent[];
  conversationMessages?: PersonalAdapterMessage[];
} | null | undefined;

function runEventString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function runEventPlanEntries(event: PersonalAdapterRunEvent): unknown[] {
  if (Array.isArray(event.plan?.entries)) return event.plan.entries;
  const entries = event.data?.entries;
  return Array.isArray(entries) ? entries : [];
}

function runEventResolution(value: unknown) {
  return value && typeof value === "object"
    ? (value as { target?: string; kind?: string; message?: string })
    : null;
}

export function shouldJoinAssistantChunkTightly(current: string, next: string) {
  if (!current || /^\s/.test(next) || /\s$/.test(current)) return true;
  if (/^[,.;:!?，。！？、；：）)\]}]/.test(next)) return true;
  if (/[（([{]$/.test(current)) return true;
  if (/[\u4e00-\u9fff]$/.test(current) || /^[\u4e00-\u9fff]/.test(next)) return true;
  return false;
}

/** Map a single personal run event into zero or more intermediate messages. */
export function mapPersonalEventToMessages(
  event: PersonalAdapterRunEvent,
  index: number,
): PersonalAdapterMessage[] {
  const text = (event.text ?? "").trim();
  if (!text) return [];
  const createdAt = event.at || Date.now();
  const id = `event-${index}`;
  if (event.type === "assistant_chunk") {
    return [{ id, type: "text", role: "assistant", text, createdAt, sourceEventType: event.type }];
  }
  if (event.type === "assistant" || event.type === "finish") {
    return [{ id, type: "finish", role: "assistant", text, createdAt, sourceEventType: event.type }];
  }
  if (event.type === "tool") {
    return [{
      id,
      type: "tool",
      role: "tool",
      text,
      createdAt,
      sourceEventType: event.type,
      status: /failed|error/i.test(text) ? "failed" : "running",
      toolCall: event.toolCall ?? null,
    }];
  }
  if (event.type === "acp_tool_call") {
    return [{
      id,
      type: "acp_tool_call",
      role: "tool",
      text,
      createdAt,
      sourceEventType: event.type,
      status: (typeof event.update?.status === "string" ? event.update.status : undefined) ?? "running",
      update: event.update ?? null,
      msgId: event.msgId ?? null,
    }];
  }
  if (event.type === "plan") {
    return [{
      id,
      type: "plan",
      role: "assistant",
      text,
      createdAt,
      sourceEventType: event.type,
      entries: runEventPlanEntries(event),
    }];
  }
  if (event.type === "thinking") {
    return [{
      id,
      type: "thinking",
      role: "assistant",
      text,
      createdAt,
      sourceEventType: event.type,
      status: event.status ?? runEventString(event.data?.status) ?? "thinking",
      msgId: event.msgId ?? null,
      durationMs: event.durationMs ?? null,
      startedAt: event.startedAt ?? null,
    }];
  }
  if (event.type === "tips") {
    return [{
      id,
      type: "tips",
      role: "system",
      text,
      createdAt,
      sourceEventType: event.type,
      category: event.category ?? runEventString(event.data?.category) ?? "info",
      ownership: event.ownership ?? runEventString(event.data?.ownership),
      resolution: event.resolution ?? runEventResolution(event.data?.resolution),
    }];
  }
  if (event.type === "approval_request") {
    return [{
      id,
      type: "permission",
      role: "system",
      text,
      createdAt,
      sourceEventType: event.type,
      approval: event.approval ?? null,
    }];
  }
  if (event.type === "error") {
    return [{ id, type: "error", role: "system", text, createdAt, sourceEventType: event.type }];
  }
  if (event.type === "status") {
    return [{ id, type: "agent_status", role: "system", text, createdAt, sourceEventType: event.type }];
  }
  return [];
}

/** Filter intermediate messages the same way the personal timeline UI does. */
export function filterPersonalTimelineMessages(
  messages: PersonalAdapterMessage[],
): PersonalAdapterMessage[] {
  return messages.filter((message) => {
    if (message.type === "thought") return false;
    // Grok-style skill inventory dumps are noise in the transcript timeline.
    if (
      (message.role === "assistant" || message.type === "text" || message.type === "finish")
      && looksLikeSkillCatalogDump(message.text)
      && !stripSkillCatalogDump(message.text).trim()
    ) {
      return false;
    }
    if (
      !message.text.trim()
      && !(message.type === "thinking" && (message.status === "done" || message.status === "completed"))
    ) {
      return false;
    }
    if (message.type === "finish") return false;
    // Streaming assistant text is folded into the parent chat bubble; hide run chunks here.
    if (message.role === "assistant" && message.type === "text") return false;
    if (message.type === "agent_status") return false;
    if (message.type === "available_commands" || message.type === "context_usage") return false;
    if (message.type === "tool" && !message.toolCall?.id) return false;
    if (message.type === "acp_tool_call" && !message.update?.toolCallId) return false;
    return true;
  });
}

/** Group plan/thinking/assistant chunks (mirrors personal timeline UI). */
export function groupPersonalTimelineMessages(
  messages: PersonalAdapterMessage[],
): PersonalAdapterMessage[] {
  const grouped: PersonalAdapterMessage[] = [];
  const thinkingIndexByKey = new Map<string, number>();
  let planIndex = -1;
  for (const message of messages) {
    if (message.type === "plan") {
      if (planIndex >= 0) {
        grouped[planIndex] = { ...message, id: grouped[planIndex]!.id };
      } else {
        planIndex = grouped.length;
        grouped.push({ ...message, id: "plan-card" });
      }
      continue;
    }
    if (message.type === "thinking") {
      const key = message.msgId ?? "__default__";
      const existingIndex = thinkingIndexByKey.get(key);
      if (existingIndex !== undefined) {
        const existing = grouped[existingIndex]!;
        const isDone = message.status === "done" || message.status === "completed";
        grouped[existingIndex] = {
          ...existing,
          text: message.text ? `${existing.text}${message.text}` : existing.text,
          status: isDone ? "done" : existing.status ?? "thinking",
          durationMs: message.durationMs ?? existing.durationMs ?? null,
          startedAt: existing.startedAt ?? message.startedAt ?? null,
          createdAt: message.createdAt || existing.createdAt,
        };
        continue;
      }
      const idx = grouped.length;
      grouped.push({ ...message, id: `thinking-${key}` });
      thinkingIndexByKey.set(key, idx);
      continue;
    }
    const previous = grouped[grouped.length - 1];
    const isAssistantChunk = message.role === "assistant" && message.type === "text";
    const previousIsAssistantChunk = previous?.role === "assistant" && previous.type === "text";
    if (isAssistantChunk && previous && previousIsAssistantChunk) {
      grouped[grouped.length - 1] = {
        ...previous,
        id: `${previous.id}-${message.id}`,
        text: shouldJoinAssistantChunkTightly(previous.text, message.text)
          ? `${previous.text}${message.text}`
          : `${previous.text}\n${message.text}`,
        createdAt: message.createdAt,
      };
      continue;
    }
    grouped.push(message);
  }
  return grouped;
}

/** Full personal timeline pipeline → intermediate messages (UI-compatible shape). */
export function mapPersonalRunToMessages(run: PersonalAdapterRun): PersonalAdapterMessage[] {
  const sourceMessages = run?.conversationMessages?.length
    ? run.conversationMessages
    : (run?.events ?? []).flatMap((event, index) => mapPersonalEventToMessages(event, index));
  return groupPersonalTimelineMessages(filterPersonalTimelineMessages(sourceMessages));
}

function personalMessageKind(message: PersonalAdapterMessage): ConversationItemKind {
  switch (message.type) {
    case "tool":
    case "acp_tool_call":
    case "tool_group":
      return "tool";
    case "thinking":
      return "thinking";
    case "plan":
      return "plan";
    case "permission":
      return "approval";
    case "error":
      return "error";
    case "tips":
      return "tips";
    case "text":
    case "content":
      if (message.role === "user") return "user_text";
      if (message.role === "assistant") return "assistant_text";
      return "system";
    default:
      if (message.role === "user") return "user_text";
      if (message.role === "assistant") return "assistant_text";
      if (message.role === "tool") return "tool";
      return "system";
  }
}

function personalToolName(message: PersonalAdapterMessage): string | null {
  const tool = message.toolCall;
  const update = message.update;
  if (typeof tool?.name === "string" && tool.name.trim()) return tool.name.trim();
  if (typeof update?.title === "string" && update.title.trim()) return update.title.trim();
  if (typeof tool?.kind === "string" && tool.kind.trim()) return tool.kind.trim();
  if (typeof update?.kind === "string" && update.kind.trim()) return update.kind.trim();
  const text = message.text?.trim();
  return text || null;
}

function personalApprovalId(message: PersonalAdapterMessage): string | null {
  const id = message.approval?.id;
  return typeof id === "string" && id.trim() ? id : null;
}

/** Map intermediate personal messages to runtime-agnostic item VMs. */
export function personalMessagesToConversationItems(
  messages: PersonalAdapterMessage[],
): ConversationItemVM[] {
  return messages.map((message) => {
    const kind = personalMessageKind(message);
    const meta: Record<string, unknown> = {
      personalType: message.type,
      sourceEventType: message.sourceEventType,
    };
    if (message.toolCall != null) meta.toolCall = message.toolCall;
    if (message.update != null) meta.update = message.update;
    if (message.approval != null) meta.approval = message.approval;
    if (message.entries != null) meta.entries = message.entries;
    if (message.msgId != null) meta.msgId = message.msgId;
    if (message.durationMs != null) meta.durationMs = message.durationMs;
    if (message.startedAt != null) meta.startedAt = message.startedAt;
    if (message.category != null) meta.category = message.category;
    if (message.ownership != null) meta.ownership = message.ownership;
    if (message.resolution != null) meta.resolution = message.resolution;
    if (message.toolCalls != null) meta.toolCalls = message.toolCalls;

    const toolName = kind === "tool" ? personalToolName(message) : null;
    const toolStatus =
      kind === "tool"
        ? (message.status
          ?? (typeof message.update?.status === "string" ? message.update.status : null)
          ?? (typeof message.toolCall?.status === "string" ? message.toolCall.status : null)
          ?? null)
        : null;
    const thinkingStatus = kind === "thinking" ? (message.status ?? null) : null;
    const approvalId = kind === "approval" ? personalApprovalId(message) : null;

    return {
      id: message.id,
      kind,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
      status: message.status ?? null,
      toolName,
      toolStatus,
      thinkingStatus,
      approvalId,
      meta,
    };
  });
}

/** Primary personal adapter entry: run → ConversationItemVM[]. */
export function toConversationItems(run: PersonalAdapterRun): ConversationItemVM[] {
  return personalMessagesToConversationItems(mapPersonalRunToMessages(run));
}
