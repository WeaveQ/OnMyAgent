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
  toolCallId?: string;
  state?: string;
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

function toolParts(message: OpenCodeMessageLike): OpenCodeMessagePartLike[] {
  const parts = Array.isArray(message.parts)
    ? message.parts
    : Array.isArray(message.content)
      ? message.content
      : [];
  return parts.filter((part) => {
    const type = `${part.type ?? ""}`.toLowerCase();
    return (
      type === "tool-invocation"
      || type === "dynamic-tool"
      || type === "tool-call"
      || type.startsWith("tool-")
      || Boolean(part.toolCallId || part.toolName)
    );
  });
}

function roleOf(message: OpenCodeMessageLike): ConversationItemVM["role"] {
  if (message.role === "user" || message.role === "assistant" || message.role === "system" || message.role === "tool") {
    return message.role;
  }
  return "assistant";
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
    const toolName = typeof part.toolName === "string" ? part.toolName : "tool";
    const status = typeof part.state === "string" ? part.state : null;
    items.push({
      id: toolId,
      kind: "tool",
      role: "tool",
      text: toolName,
      createdAt,
      status,
      meta: {
        source: "opencode",
        toolName,
        toolCallId: part.toolCallId,
        input: part.input,
        output: part.output,
        partType: part.type,
      },
    });
  }

  return items;
}

/** Map UIMessage-like list → ConversationItemVM[]. */
export function toConversationItems(messages: OpenCodeMessageLike[] | null | undefined): ConversationItemVM[] {
  if (!messages?.length) return [];
  return messages.flatMap((message, index) => mapOpenCodeMessageToItems(message, index));
}
