import type { UIMessage } from "ai";

import { readTranscriptMessageMetadata } from "../../sync/message-metadata";

export type TranscriptTurnState =
  | "pending"
  | "streaming"
  | "awaiting-approval"
  | "completed"
  | "cancelled"
  | "failed";

export type TranscriptTurn = {
  id: string;
  messages: UIMessage[];
  userMessage: UIMessage | null;
  assistantMessages: UIMessage[];
  state: TranscriptTurnState;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
  actionMessageId: string | null;
};

type BuildTranscriptTurnsOptions = {
  isStreaming: boolean;
  hasPendingApproval?: boolean;
  cancelledMessageIds?: ReadonlySet<string>;
};

type MutableTranscriptTurn = {
  id: string;
  messages: UIMessage[];
  userMessage: UIMessage | null;
  assistantMessages: UIMessage[];
};

function startTurn(message: UIMessage): MutableTranscriptTurn {
  return {
    id: message.id,
    messages: [message],
    userMessage: message.role === "user" ? message : null,
    assistantMessages: message.role === "assistant" ? [message] : [],
  };
}

function appendMessage(turn: MutableTranscriptTurn, message: UIMessage) {
  turn.messages.push(message);
  if (message.role === "assistant") turn.assistantMessages.push(message);
}

function latestNumber(values: Array<number | null>) {
  const available = values.filter((value): value is number => value !== null);
  return available.length > 0 ? Math.max(...available) : null;
}

function finalizeTurn(
  turn: MutableTranscriptTurn,
  index: number,
  total: number,
  options: BuildTranscriptTurnsOptions,
): TranscriptTurn {
  const isLastTurn = index === total - 1;
  const messageMetadata = turn.messages.map((message) => ({
    id: message.id,
    value: readTranscriptMessageMetadata(message.metadata),
  }));
  const userMetadata = turn.userMessage
    ? readTranscriptMessageMetadata(turn.userMessage.metadata)
    : null;
  const startedAt = userMetadata?.created ?? messageMetadata[0]?.value.created ?? null;
  const completedAt = latestNumber(
    turn.assistantMessages.map(
      (message) => readTranscriptMessageMetadata(message.metadata).completed,
    ),
  );
  const lastAssistantMessage = turn.assistantMessages.at(-1);
  const lastAssistantCompleted = lastAssistantMessage
    ? readTranscriptMessageMetadata(lastAssistantMessage.metadata).completed !== null
    : false;
  const live = isLastTurn && !lastAssistantCompleted;
  const hasCancellation = messageMetadata.some(
    (item) =>
      item.value.errorName === "MessageAbortedError" ||
      options.cancelledMessageIds?.has(item.id) === true,
  );
  const hasFailure = turn.assistantMessages.some((message) => {
    const metadata = readTranscriptMessageMetadata(message.metadata);
    return metadata.errorName !== null && metadata.errorName !== "MessageAbortedError";
  });

  let state: TranscriptTurnState;
  if (hasCancellation) state = "cancelled";
  else if (live && options.hasPendingApproval) state = "awaiting-approval";
  else if (live && options.isStreaming) state = "streaming";
  else if (hasFailure) state = "failed";
  else if (turn.assistantMessages.length === 0) state = "pending";
  else state = "completed";

  const terminal = state === "completed" || state === "cancelled" || state === "failed";

  return {
    ...turn,
    state,
    startedAt,
    completedAt,
    durationMs:
      terminal && startedAt !== null && completedAt !== null
        ? Math.max(0, completedAt - startedAt)
        : null,
    actionMessageId: turn.assistantMessages.at(-1)?.id ?? null,
  };
}

export function buildTranscriptTurns(
  messages: UIMessage[],
  options: BuildTranscriptTurnsOptions,
): TranscriptTurn[] {
  const grouped: MutableTranscriptTurn[] = [];
  let current: MutableTranscriptTurn | null = null;

  for (const message of messages) {
    if (message.role === "user" || current === null) {
      if (current) grouped.push(current);
      current = startTurn(message);
      continue;
    }
    appendMessage(current, message);
  }

  if (current) grouped.push(current);
  return grouped.map((turn, index) => finalizeTurn(turn, index, grouped.length, options));
}
