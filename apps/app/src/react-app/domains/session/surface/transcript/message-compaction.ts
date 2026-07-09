/** Transcript compaction filtering helpers — pure message filters. */
import type { UIMessage } from "ai";


export function messageActivityFingerprint(messages: UIMessage[]) {
  return messages
    .map((message) => {
      const partToken = message.parts
        .map((part) => {
          if ("text" in part && typeof part.text === "string") {
            return `${part.type}:${part.text.length}`;
          }
          if (part.type === "dynamic-tool") {
            const record = part as Record<string, unknown>;
            const state = typeof record.state === "string" ? record.state : "";
            const toolName = typeof record.toolName === "string" ? record.toolName : "";
            return `${part.type}:${toolName}:${state}`;
          }
          return part.type;
        })
        .join(",");
      return `${message.id}:${message.role}:${partToken}`;
    })
    .join("|");
}

export function compactCandidateText(message: UIMessage) {
  if (message.role !== "assistant") return "";
  return message.parts
    .flatMap((part) => {
      if ("text" in part && typeof part.text === "string") return [part.text];
      return [];
    })
    .join("\n")
    .trim();
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isLikelyCompactSummaryMessage(message: UIMessage) {
  const text = compactCandidateText(message);
  if (text.length < 320) return false;
  const headings = [
    "Summary",
    "Current State",
    "Completed",
    "Done",
    "In Progress",
    "Blocked",
    "Key Decisions",
    "Next Steps",
    "Progress",
    "\u5f53\u524d\u72b6\u6001",
    "\u6458\u8981",
    "\u5df2\u5b8c\u6210",
    "\u5b8c\u6210",
    "\u8fdb\u884c\u4e2d",
    "\u963b\u585e",
    "\u5173\u952e\u51b3\u7b56",
    "\u4e0b\u4e00\u6b65",
    "\u8fdb\u5ea6",
  ];
  const headingHits = headings.filter((heading) => {
    const escapedHeading = escapeRegExp(heading);
    return new RegExp(
      `(^|\\n)\\s*(?:#+\\s*)?${escapedHeading}(?:\\s|[:：]|$)`,
      "i",
    ).test(text);
  }).length;
  return headingHits >= 3;
}

export function filterCompactionMessages(
  messages: UIMessage[],
  compactBoundary: number | null,
) {
  let beforeNextUserAfterBoundary = compactBoundary !== null;
  return messages.filter((message, index) => {
    if (compactBoundary !== null && index >= compactBoundary) {
      if (message.role === "user") beforeNextUserAfterBoundary = false;
      if (
        beforeNextUserAfterBoundary &&
        message.role === "assistant" &&
        isLikelyCompactSummaryMessage(message)
      ) {
        return false;
      }
    }
    return !isLikelyCompactSummaryMessage(message);
  });
}

