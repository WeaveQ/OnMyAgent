import type { UIMessage } from "ai";
import { APP_NAME } from "../../../../i18n/locales/brand";

export const DEFAULT_COMPOSER_CONTROL_TEXT = `Help me outline the next ${APP_NAME} task.`;

export function messageBodySearchText(message: UIMessage) {
  return message.parts
    .flatMap((part) => {
      if (part.type === "text") return [part.text];
      if (part.type === "reasoning") return [part.text];
      if (part.type === "dynamic-tool") {
        if (part.state === "output-error")
          return [`[tool:${part.toolName}] ${part.errorText}`];
        if (part.state === "output-available")
          return [`[tool:${part.toolName}] ${JSON.stringify(part.output)}`];
        return [`[tool:${part.toolName}] ${JSON.stringify(part.input)}`];
      }
      return [];
    })
    .join("\n\n")
    .trim();
}

export function messageToReadableText(message: UIMessage) {
  const header =
    message.role === "user"
      ? "You"
      : message.role === "assistant"
        ? "OnMyAgent"
        : message.role;
  const body = messageBodySearchText(message);
  return `${header}\n${body}`.trim();
}

/** Message ids that contain the query (document order, oldest → newest). */
export function findTranscriptSearchMatchIds(
  messages: UIMessage[],
  query: string,
): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const ids: string[] = [];
  for (const message of messages) {
    if (!message.id) continue;
    const body = messageBodySearchText(message);
    if (body && body.toLowerCase().includes(needle)) {
      ids.push(message.id);
    }
  }
  return ids;
}

export function transcriptToText(messages: UIMessage[]) {
  return messages
    .flatMap((message) => {
      const text = messageToReadableText(message);
      return text ? [text] : [];
    })
    .join("\n\n---\n\n");
}

export function controlTextArgument(args: unknown) {
  if (typeof args === "string") return args;
  if (args && typeof args === "object" && "text" in args) {
    const text = (args as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return DEFAULT_COMPOSER_CONTROL_TEXT;
}

export function controlRecentMessageCount(args: unknown) {
  return typeof args === "object" &&
    args !== null &&
    "count" in args &&
    typeof (args as { count?: unknown }).count === "number"
    ? Math.min(Math.max(1, (args as { count: number }).count), 30)
    : 10;
}

export function latestMessageControlResult(input: {
  messages: UIMessage[];
  sessionId: string;
}) {
  const message = input.messages[input.messages.length - 1];
  if (!message) return null;
  return {
    ok: true,
    sessionId: input.sessionId,
    index: input.messages.length - 1,
    role: message.role,
    text: messageToReadableText(message),
  };
}

export function transcriptControlResult(input: {
  count: number;
  messages: UIMessage[];
  sessionId: string;
}) {
  const total = input.messages.length;
  const slice = input.messages.slice(-input.count);
  if (!slice.length) return null;
  return {
    ok: true,
    sessionId: input.sessionId,
    messageCount: total,
    returned: slice.length,
    messages: slice.map((message, index) => ({
      index: total - slice.length + index,
      role: message.role,
      text: messageToReadableText(message),
    })),
  };
}

export function messageHasVisibleAssistantOutput(message: UIMessage) {
  if (message.role !== "assistant") return false;
  return message.parts.some((part) => {
    if ("text" in part && typeof part.text === "string")
      return part.text.trim().length > 0;
    return part.type === "dynamic-tool" || part.type === "file";
  });
}

function formatAssistantFallbackValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function assistantFallbackPartToText(part: UIMessage["parts"][number]) {
  if (part.type === "text" || part.type === "reasoning")
    return part.text.trim();
  if (part.type === "file") return (part.filename ?? part.url).trim();

  const record = part as Record<string, unknown>;
  const toolName = typeof record.toolName === "string" ? record.toolName : null;
  if (toolName) {
    if (typeof record.errorText === "string" && record.errorText.trim()) {
      return `[tool:${toolName}] ${record.errorText.trim()}`;
    }
    const output = formatAssistantFallbackValue(record.output);
    if (output) return `[tool:${toolName}] ${output}`;
    const input = formatAssistantFallbackValue(record.input);
    if (input) return `[tool:${toolName}] ${input}`;
    return `[tool:${toolName}]`;
  }

  const unknown = formatAssistantFallbackValue(record);
  return unknown === "{}" ? "" : unknown;
}

export function assistantFallbackText(messages: UIMessage[], baseline: number) {
  return messages
    .slice(baseline)
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.parts.map(assistantFallbackPartToText))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}
