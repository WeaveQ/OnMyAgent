/**
 * Pure OpenCode / UIMessage-like adapters → ConversationItemVM.
 * Intentionally lightweight: text parts + tool-invocation-ish parts only.
 * Does not rewrite session message-list rendering.
 */

import type { ConversationItemVM } from "../item-types";

export type OpenCodeMessagePartLike = {
  type?: string;
  text?: string;
  toolName?: string;
  tool?: string;
  toolCallId?: string;
  state?: string | Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  [key: string]: unknown;
};

export type OpenCodeMessageLike = {
  id: string;
  role: "user" | "assistant" | "system" | "tool" | string;
  parts?: OpenCodeMessagePartLike[];
  content?: string | OpenCodeMessagePartLike[];
  text?: string;
  createdAt?: number;
};

function textFromParts(parts: OpenCodeMessagePartLike[] | undefined): string {
  if (!parts?.length) return "";
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
}

function resolveMessageText(message: OpenCodeMessageLike): string {
  if (typeof message.text === "string" && message.text.trim()) return message.text;
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) return textFromParts(message.content);
  return textFromParts(message.parts);
}

function messageParts(message: OpenCodeMessageLike): OpenCodeMessagePartLike[] {
  if (Array.isArray(message.parts)) return message.parts;
  if (Array.isArray(message.content)) return message.content;
  return [];
}

function isToolPart(part: OpenCodeMessagePartLike): boolean {
  const type = `${part.type ?? ""}`.toLowerCase();
  return (
    type === "tool-invocation"
    || type === "dynamic-tool"
    || type === "tool-call"
    || type === "tool"
    || type.startsWith("tool-")
    || Boolean(part.toolCallId || part.toolName || part.tool)
  );
}

function isReasoningPart(part: OpenCodeMessagePartLike): boolean {
  const type = `${part.type ?? ""}`.toLowerCase();
  return type === "reasoning" || type === "thinking";
}

function toolParts(message: OpenCodeMessageLike): OpenCodeMessagePartLike[] {
  return messageParts(message).filter(isToolPart);
}

function reasoningParts(message: OpenCodeMessageLike): OpenCodeMessagePartLike[] {
  return messageParts(message).filter(isReasoningPart);
}

function roleOf(message: OpenCodeMessageLike): ConversationItemVM["role"] {
  if (message.role === "user" || message.role === "assistant" || message.role === "system" || message.role === "tool") {
    return message.role;
  }
  return "assistant";
}

function resolvePartState(part: OpenCodeMessagePartLike): string | null {
  if (typeof part.state === "string") return part.state;
  if (part.state && typeof part.state === "object") {
    const status = (part.state as Record<string, unknown>).status;
    if (typeof status === "string") return status;
  }
  return null;
}

function resolveToolName(part: OpenCodeMessagePartLike): string {
  if (typeof part.toolName === "string" && part.toolName.trim()) return part.toolName;
  if (typeof part.tool === "string" && part.tool.trim()) return part.tool;
  return "tool";
}

/**
 * Map a single OpenCode tool-ish part → ConversationItemVM.
 * Used by shared UI bridges without pulling in the full message-list stack.
 */
export function mapOpenCodeToolPartToItem(
  part: OpenCodeMessagePartLike,
  options?: { id?: string; createdAt?: number; index?: number },
): ConversationItemVM {
  const index = options?.index ?? 0;
  const toolName = resolveToolName(part);
  const status = resolvePartState(part);
  const toolId =
    options?.id
    || (typeof part.toolCallId === "string" && part.toolCallId)
    || `tool-${index}`;
  return {
    id: toolId,
    kind: "tool",
    role: "tool",
    text: toolName,
    createdAt: options?.createdAt ?? index,
    status,
    toolName,
    toolStatus: status,
    meta: {
      source: "opencode",
      toolName,
      toolCallId: part.toolCallId,
      input: part.input ?? (typeof part.state === "object" ? (part.state as Record<string, unknown>)?.input : undefined),
      output: part.output ?? (typeof part.state === "object" ? (part.state as Record<string, unknown>)?.output : undefined),
      partType: part.type,
    },
  };
}

/** Map a reasoning/thinking part → ConversationItemVM. */
export function mapOpenCodeReasoningPartToItem(
  part: OpenCodeMessagePartLike,
  options?: { id?: string; createdAt?: number; index?: number; complete?: boolean },
): ConversationItemVM {
  const index = options?.index ?? 0;
  const text = typeof part.text === "string" ? part.text : "";
  const thinkingStatus = options?.complete === false ? "thinking" : "done";
  return {
    id: options?.id ?? `reasoning-${index}`,
    kind: "thinking",
    role: "assistant",
    text,
    createdAt: options?.createdAt ?? index,
    status: thinkingStatus,
    thinkingStatus,
    meta: { source: "opencode", partType: part.type ?? "reasoning" },
  };
}

/** Map a single UIMessage-like object to zero or more ConversationItemVM rows. */
export function mapOpenCodeMessageToItems(
  message: OpenCodeMessageLike,
  index = 0,
): ConversationItemVM[] {
  const createdAt = typeof message.createdAt === "number" ? message.createdAt : index;
  const role = roleOf(message);
  const items: ConversationItemVM[] = [];
  const text = resolveMessageText(message).trim();

  if (text) {
    const kind =
      role === "user"
        ? "user_text"
        : role === "assistant"
          ? "assistant_text"
          : role === "tool"
            ? "tool"
            : "system";
    items.push({
      id: message.id,
      kind,
      role,
      text,
      createdAt,
      meta: { source: "opencode", part: "text" },
    });
  }

  for (const [toolIndex, part] of toolParts(message).entries()) {
    const toolId =
      (typeof part.toolCallId === "string" && part.toolCallId)
      || `${message.id}-tool-${toolIndex}`;
    items.push(
      mapOpenCodeToolPartToItem(part, {
        id: toolId,
        createdAt,
        index: toolIndex,
      }),
    );
  }

  for (const [reasoningIndex, part] of reasoningParts(message).entries()) {
    const body = typeof part.text === "string" ? part.text.trim() : "";
    if (!body) continue;
    items.push(
      mapOpenCodeReasoningPartToItem(part, {
        id: `${message.id}-reasoning-${reasoningIndex}`,
        createdAt,
        index: reasoningIndex,
        complete: true,
      }),
    );
  }

  return items;
}

/** Map UIMessage-like list → ConversationItemVM[]. */
export function toConversationItems(messages: OpenCodeMessageLike[] | null | undefined): ConversationItemVM[] {
  if (!messages?.length) return [];
  return messages.flatMap((message, index) => mapOpenCodeMessageToItems(message, index));
}
