export const CROSS_RUNTIME_FORK_CONTEXT_CHAR_LIMIT = 16_000;

type ForkContextPart = {
  type: string;
  text?: string;
};

type ForkContextMessage = {
  role: string;
  parts: readonly ForkContextPart[];
};

/** Newest complete messages, always keeping the last user text. */
export function clipCrossRuntimeForkContext(
  messages: readonly ForkContextMessage[],
  limit = CROSS_RUNTIME_FORK_CONTEXT_CHAR_LIMIT,
): string {
  const entries = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role,
      text: message.parts
        .filter((part) => part.type === "text" && part.text)
        .map((part) => part.text ?? "")
        .join("\n")
        .trim(),
    }))
    .filter((entry) => entry.text.length > 0);
  if (entries.length === 0) return "";

  const texts = entries.map((entry) => entry.text);
  let lastUserIndex = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) {
    return clipCompleteSuffix(texts, limit);
  }

  const lastUser = texts[lastUserIndex] ?? "";
  if (lastUser.length >= limit) return lastUser.slice(-limit);

  const pieces = [lastUser];
  let used = lastUser.length;
  for (let index = lastUserIndex + 1; index < texts.length; index += 1) {
    const extra = 1 + (texts[index]?.length ?? 0);
    if (used + extra > limit) break;
    pieces.push(texts[index] ?? "");
    used += extra;
  }
  for (let index = lastUserIndex - 1; index >= 0; index -= 1) {
    const extra = 1 + (texts[index]?.length ?? 0);
    if (used + extra > limit) break;
    pieces.unshift(texts[index] ?? "");
    used += extra;
  }
  return pieces.join("\n");
}

function clipCompleteSuffix(texts: readonly string[], limit: number): string {
  let start = 0;
  while (start < texts.length - 1 && joinedLength(texts, start) > limit) {
    start += 1;
  }
  const joined = texts.slice(start).join("\n");
  return joined.length > limit ? joined.slice(-limit) : joined;
}

function joinedLength(texts: readonly string[], start: number): number {
  if (start >= texts.length) return 0;
  return texts.slice(start).join("\n").length;
}
