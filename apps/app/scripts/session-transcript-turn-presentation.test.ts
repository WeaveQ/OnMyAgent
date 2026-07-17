import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import enSession from "../src/i18n/locales/en/session";
import zhTWSession from "../src/i18n/locales/zh-TW/session";
import zhSession from "../src/i18n/locales/zh/session";
import { createTranscriptMessageMetadata } from "../src/react-app/domains/session/sync/message-metadata";
import { buildTranscriptTurns } from "../src/react-app/domains/session/surface/transcript/turn-model";
import {
  formatCompactTokenCount,
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
          tokens: {
            input: 10,
            output: 20,
            reasoning: 5,
            cache: { read: 30, write: 40 },
          },
        })),
        message("assistant-2", "assistant", "second", createTranscriptMessageMetadata({
          time: { created: 2_100, completed: 4_000 },
          providerID: "provider-b",
          modelID: "model-b",
          cost: 0.016,
          tokens: {
            total: 9_999,
            input: 100,
            output: 200,
            reasoning: 50,
            cache: { read: 300, write: 400 },
          },
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
    expect(presentation.requestId).toBe("user");
    expect(presentation.providerId).toBe("provider-b");
    expect(presentation.modelId).toBe("model-b");
    expect(presentation.inputTokens).toBe(110);
    expect(presentation.cacheTokens).toBe(770);
    expect(presentation.outputTokens).toBe(275);
    expect(presentation.timestamp).toBe(4_000);
    expect(presentation.durationMs).toBe(3_000);
  });

  test("returns no token totals when assistant usage is unavailable", () => {
    const turn = buildTranscriptTurns(
      [message("user", "user", "question"), message("assistant", "assistant", "answer")],
      { isStreaming: false },
    )[0];
    expect(turn).toBeDefined();
    if (!turn) return;

    const presentation = summarizeTranscriptTurn(turn, () => "answer");
    expect(presentation.inputTokens).toBeNull();
    expect(presentation.cacheTokens).toBeNull();
    expect(presentation.outputTokens).toBeNull();
  });

  test("preserves explicitly reported zero token usage", () => {
    const turn = buildTranscriptTurns(
      [
        message("user", "user", "question"),
        message("assistant", "assistant", "answer", createTranscriptMessageMetadata({
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            cache: { read: 0, write: 0 },
          },
        })),
      ],
      { isStreaming: false },
    )[0];
    expect(turn).toBeDefined();
    if (!turn) return;

    const presentation = summarizeTranscriptTurn(turn, () => "answer");
    expect(presentation.inputTokens).toBe(0);
    expect(presentation.cacheTokens).toBe(0);
    expect(presentation.outputTokens).toBe(0);
  });

  test("labels input, cached, and output tokens explicitly in every locale", () => {
    expect(enSession["session.transcript_token_usage"]).toBe(
      "Input {input} · cached {cache} · output {output} tokens",
    );
    expect(zhSession["session.transcript_token_usage"]).toBe(
      "输入 {input} · 缓存 {cache} · 输出 {output} tokens",
    );
    expect(zhTWSession["session.transcript_token_usage"]).toBe(
      "輸入 {input} · 快取 {cache} · 輸出 {output} tokens",
    );
  });

  test("formats token counts with compact decimal suffixes", () => {
    expect(formatCompactTokenCount(null)).toBeNull();
    expect(formatCompactTokenCount(-1)).toBeNull();
    expect(formatCompactTokenCount(0)).toBe("0");
    expect(formatCompactTokenCount(999)).toBe("999");
    expect(formatCompactTokenCount(1_000)).toBe("1k");
    expect(formatCompactTokenCount(1_500)).toBe("1.5k");
    expect(formatCompactTokenCount(999_999)).toBe("1000k");
    expect(formatCompactTokenCount(1_000_000)).toBe("1m");
    expect(formatCompactTokenCount(1_500_000_000)).toBe("1.5b");
  });
});
