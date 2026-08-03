import type { UIMessage } from "ai";

type OptimisticSessionUserMessageInput = {
  messageId: string;
  text: string;
  createdAt: number;
};

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
