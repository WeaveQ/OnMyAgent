import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import { createTranscriptMessageMetadata } from "../src/react-app/domains/session/sync/message-metadata";
import { buildTranscriptTurns } from "../src/react-app/domains/session/surface/transcript/turn-model";
import {
  formatTranscriptCost,
  summarizeTranscriptTurn,
} from "../src/react-app/domains/session/surface/transcript/turn-presentation";

function message(
  id: string,
  role: UIMessage["role"],
  text: string,
  metadata?: UIMessage["metadata"],
): UIMessage {
  return {
    id,
    role,
    ...(metadata === undefined ? {} : { metadata }),
    parts: [{ type: "text", text }],
  };
}

describe("session transcript turn presentation", () => {
  test("summarizes only real assistant metadata and output", () => {
    const turn = buildTranscriptTurns(
      [
        message("user", "user", "question", createTranscriptMessageMetadata({ time: { created: 1_000 } })),
        message("assistant-1", "assistant", "first", createTranscriptMessageMetadata({
          time: { created: 1_100, completed: 2_000 },
          providerID: "provider-a",
          modelID: "model-a",
          cost: 0.004,
        })),
        message("assistant-2", "assistant", "second", createTranscriptMessageMetadata({
          time: { created: 2_100, completed: 4_000 },
          providerID: "provider-b",
          modelID: "model-b",
          cost: 0.016,
        })),
      ],
      { isStreaming: false },
    )[0];
    expect(turn).toBeDefined();
    if (!turn) return;

    const presentation = summarizeTranscriptTurn(turn, (item) =>
      item.parts.map((part) => part.type === "text" ? part.text : "").join(""),
    );
    expect(presentation.copyText).toBe("first\n\nsecond");
    expect(presentation.providerId).toBe("provider-b");
    expect(presentation.modelId).toBe("model-b");
    expect(presentation.cost).toBeCloseTo(0.02);
    expect(presentation.timestamp).toBe(4_000);
    expect(presentation.durationMs).toBe(3_000);
  });

  test("formats zero, tiny, and regular costs without inventing currency", () => {
    expect(formatTranscriptCost(null)).toBeNull();
    expect(formatTranscriptCost(-1)).toBeNull();
    expect(formatTranscriptCost(0)).toBe("0");
    expect(formatTranscriptCost(0.004)).toBe("0.0040");
    expect(formatTranscriptCost(4.924)).toBe("4.92");
  });
});
