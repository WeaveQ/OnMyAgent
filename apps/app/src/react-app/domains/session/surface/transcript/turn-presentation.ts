import { readTranscriptMessageMetadata } from "../../sync/message-metadata";
import type { TranscriptTurn } from "./turn-model";

export type TranscriptTurnPresentation = {
  turnId: string;
  state: TranscriptTurn["state"];
  durationMs: number | null;
  requestId: string;
  actionMessageId: string | null;
  copyText: string;
  providerId: string | null;
  modelId: string | null;
  inputTokens: number | null;
  cacheTokens: number | null;
  outputTokens: number | null;
  timestamp: number | null;
};

function sumReportedTokenParts(parts: Array<number | null>) {
  const reported = parts.filter((value): value is number => value !== null);
  return reported.length > 0
    ? reported.reduce((sum, value) => sum + value, 0)
    : null;
}

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
  const inputTokenCounts = assistantMetadata
    .map((metadata) => metadata.tokens?.input ?? null)
    .filter((tokens): tokens is number => tokens !== null);
  const cacheTokenCounts = assistantMetadata
    .map((metadata) => metadata.tokens && sumReportedTokenParts([
      metadata.tokens.cacheRead,
      metadata.tokens.cacheWrite,
    ]))
    .filter((tokens): tokens is number => tokens !== null);
  const outputTokenCounts = assistantMetadata
    .map((metadata) => metadata.tokens && sumReportedTokenParts([
      metadata.tokens.output,
      metadata.tokens.reasoning,
    ]))
    .filter((tokens): tokens is number => tokens !== null);
  const latestAssistantTimestamp = assistantMetadata
    .map((metadata) => metadata.completed ?? metadata.created)
    .filter((timestamp): timestamp is number => timestamp !== null)
    .at(-1);

  return {
    turnId: turn.id,
    state: turn.state,
    durationMs: turn.durationMs,
    requestId: turn.userMessage?.id ?? turn.id,
    actionMessageId: turn.actionMessageId,
    copyText: turn.assistantMessages
      .map(messageText)
      .filter((text) => text.trim().length > 0)
      .join("\n\n"),
    providerId: metadataWithModel?.providerID ?? null,
    modelId: metadataWithModel?.modelID ?? null,
    inputTokens: inputTokenCounts.length > 0
      ? inputTokenCounts.reduce((sum, tokens) => sum + tokens, 0)
      : null,
    cacheTokens: cacheTokenCounts.length > 0
      ? cacheTokenCounts.reduce((sum, tokens) => sum + tokens, 0)
      : null,
    outputTokens: outputTokenCounts.length > 0
      ? outputTokenCounts.reduce((sum, tokens) => sum + tokens, 0)
      : null,
    timestamp: turn.completedAt ?? latestAssistantTimestamp ?? turn.startedAt,
  };
}

export function formatCompactTokenCount(tokens: number | null) {
  if (tokens === null || !Number.isFinite(tokens) || tokens < 0) return null;

  const roundedTokens = Math.round(tokens);
  if (roundedTokens < 1_000) return String(roundedTokens);

  const units = ["k", "m", "b", "t"];
  const unitIndex = Math.min(
    Math.floor(Math.log(roundedTokens) / Math.log(1_000)),
    units.length,
  );
  const value = roundedTokens / (1_000 ** unitIndex);
  const compactValue = Number(value.toFixed(1));
  return `${compactValue}${units[unitIndex - 1]}`;
}
