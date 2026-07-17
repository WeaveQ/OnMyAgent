import type { UIMessage } from "ai";

import type { ComposerDraft } from "../../../../app/types";
import { readTranscriptMessageMetadata } from "./message-metadata";

export const OUTPUT_LIMIT_CONTINUATION_MESSAGE_PREFIX = "msg_onmyagent_output_limit_continue_";

const OUTPUT_LIMIT_FINISH_REASONS = new Set([
  "length",
  "max_tokens",
  "max-tokens",
  "max_output_tokens",
  "token_limit",
]);

export function isOutputLimitFinishReason(reason: unknown) {
  return typeof reason === "string" && OUTPUT_LIMIT_FINISH_REASONS.has(reason.trim().toLowerCase());
}

export function latestOutputLimitedAssistantMessage(messages: UIMessage[]) {
  const latestConversationMessage = messages.findLast(
    (message) => message.role === "user" || message.role === "assistant",
  );
  if (!latestConversationMessage || latestConversationMessage.role !== "assistant") return null;
  const metadata = readTranscriptMessageMetadata(latestConversationMessage.metadata);
  return isOutputLimitFinishReason(metadata.finishReason)
    ? latestConversationMessage
    : null;
}

export function isOutputLimitContinuationMessageId(messageID: string | undefined) {
  return Boolean(messageID?.startsWith(OUTPUT_LIMIT_CONTINUATION_MESSAGE_PREFIX));
}

export function buildOutputLimitContinuationDraft(input: {
  messageID: string;
  prompt: string;
  hiddenSystemPrompt: string;
}): ComposerDraft {
  return {
    mode: "prompt",
    messageID: input.messageID,
    text: input.prompt,
    resolvedText: input.prompt,
    parts: [{ type: "text", text: input.prompt }],
    attachments: [],
    hiddenSystemPrompt: input.hiddenSystemPrompt,
  };
}
