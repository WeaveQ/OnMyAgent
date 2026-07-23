import type { UIMessage } from "ai";
import type { SessionTranscriptDivider } from "./types";

export function isTranscriptDividerReady(
  divider: SessionTranscriptDivider | undefined,
  messageCount: number,
): boolean {
  return Boolean(divider && divider.afterMessageCount <= messageCount);
}

export function cancelledAssistantMessageIds(
  messages: UIMessage[],
  dividers: SessionTranscriptDivider[] | undefined,
) {
  const ids = new Set<string>();
  for (const divider of dividers ?? []) {
    if (divider.variant !== "cancelled") continue;
    const precedingMessages = messages.slice(
      0,
      Math.min(messages.length, divider.afterMessageCount),
    );
    const assistantMessage = precedingMessages.findLast(
      (message) => message.role === "assistant",
    );
    if (assistantMessage) ids.add(assistantMessage.id);
  }
  return ids;
}
