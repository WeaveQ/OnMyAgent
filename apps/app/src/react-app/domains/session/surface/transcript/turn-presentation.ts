import { readTranscriptMessageMetadata } from "../../sync/message-metadata";
import type { TranscriptTurn } from "./turn-model";

export type TranscriptTurnPresentation = {
  turnId: string;
  state: TranscriptTurn["state"];
  durationMs: number | null;
  actionMessageId: string | null;
  copyText: string;
  providerId: string | null;
  modelId: string | null;
  cost: number | null;
  timestamp: number | null;
};

export function summarizeTranscriptTurn(
  turn: TranscriptTurn,
  messageText: (message: TranscriptTurn["messages"][number]) => string,
): TranscriptTurnPresentation {
  const assistantMetadata = turn.assistantMessages.map((message) =>
    readTranscriptMessageMetadata(message.metadata),
  );
  const metadataWithModel = assistantMetadata.findLast(
    (metadata) => metadata.modelID !== null || metadata.providerID !== null,
  );
  const costs = assistantMetadata
    .map((metadata) => metadata.cost)
    .filter((cost): cost is number => cost !== null);
  const latestAssistantTimestamp = assistantMetadata
    .map((metadata) => metadata.completed ?? metadata.created)
    .filter((timestamp): timestamp is number => timestamp !== null)
    .at(-1);

  return {
    turnId: turn.id,
    state: turn.state,
    durationMs: turn.durationMs,
    actionMessageId: turn.actionMessageId,
    copyText: turn.assistantMessages
      .map(messageText)
      .filter((text) => text.trim().length > 0)
      .join("\n\n"),
    providerId: metadataWithModel?.providerID ?? null,
    modelId: metadataWithModel?.modelID ?? null,
    cost: costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) : null,
    timestamp: turn.completedAt ?? latestAssistantTimestamp ?? turn.startedAt,
  };
}

export function formatTranscriptCost(cost: number | null) {
  if (cost === null || cost < 0) return null;
  if (cost === 0) return "0";
  if (cost < 0.01) return cost.toPrecision(2);
  return cost.toFixed(2);
}
