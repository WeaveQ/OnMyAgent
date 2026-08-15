import type { UIMessage } from "ai";

type OptimisticSessionUserMessageInput = {
  messageId: string;
  text: string;
  createdAt: number;
};

function opencodePartId(part: UIMessage["parts"][number]) {
  if (part.type !== "text") return null;
  const metadata = part.providerMetadata?.opencode;
  if (!metadata || typeof metadata !== "object" || !("partId" in metadata)) {
    return null;
  }
  return typeof metadata.partId === "string" ? metadata.partId : null;
}

/**
 * Let the first canonical OpenCode user-text part take over the optimistic
 * placeholder instead of appending the same visible text a second time.
 */
export function adoptEquivalentOptimisticUserTextPart(
  message: UIMessage,
  canonicalPart: UIMessage["parts"][number],
): UIMessage | null {
  if (message.role !== "user" || canonicalPart.type !== "text") return null;
  const optimisticIndex = message.parts.findIndex(
    (part) =>
      part.type === "text" &&
      opencodePartId(part) === null &&
      part.text === canonicalPart.text,
  );
  if (optimisticIndex === -1) return null;

  const parts = message.parts.slice();
  parts[optimisticIndex] = canonicalPart;
  return { ...message, parts };
}

export function addOptimisticSessionUserMessage(
  current: UIMessage[],
  input: OptimisticSessionUserMessageInput,
) {
  if (current.some((message) => message.id === input.messageId)) return current;

  const message: UIMessage = {
    id: input.messageId,
    role: "user",
    metadata: { opencode: { created: input.createdAt } },
    parts: [{ type: "text", text: input.text, state: "done" }],
  };
  return [...current, message];
}

export function removeOptimisticSessionUserMessage(
  current: UIMessage[],
  messageId: string,
) {
  return current.filter((message) => message.id !== messageId);
}

function firstUserText(message: UIMessage) {
  const part = message.parts.find((item) => item.type === "text");
  return part && typeof part.text === "string" ? part.text : "";
}

function isOptimisticUserMessage(message: UIMessage) {
  return (
    message.role === "user" &&
    message.parts.every(
      (part) => part.type !== "text" || opencodePartId(part) === null,
    )
  );
}

/** Drop local first-send placeholders once the canonical user turn arrives. */
export function dropEquivalentOptimisticUserMessages(
  current: UIMessage[],
  canonical: UIMessage,
) {
  if (canonical.role !== "user") return current;
  const text = firstUserText(canonical);
  if (!text) return current;
  const next = current.filter((message) => {
    if (message.id === canonical.id) return true;
    if (!isOptimisticUserMessage(message)) return true;
    return firstUserText(message) !== text;
  });
  return next.length === current.length ? current : next;
}
