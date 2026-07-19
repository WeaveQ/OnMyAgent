import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { findTranscriptSearchMatchIds } from "../src/react-app/domains/session/surface/session-surface-model";

function textMessage(id: string, role: "user" | "assistant", text: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
  } as UIMessage;
}

describe("findTranscriptSearchMatchIds (shipped)", () => {
  test("matches assistant body containing query (e.g. 火 in 火山)", () => {
    const messages = [
      textMessage("u1", "user", "看看能力"),
      textMessage(
        "a1",
        "assistant",
        "火山方舟 ArkCLI\n- 模型查询、部署 Endpoint",
      ),
      textMessage("u2", "user", "继续"),
    ];
    const ids = findTranscriptSearchMatchIds(messages, "火");
    expect(ids).toEqual(["a1"]);
  });

  test("returns empty for blank query", () => {
    const messages = [textMessage("a1", "assistant", "火山")];
    expect(findTranscriptSearchMatchIds(messages, "  ")).toEqual([]);
  });

  test("is case-insensitive for latin", () => {
    const messages = [textMessage("a1", "assistant", "ArkCLI Endpoint")];
    expect(findTranscriptSearchMatchIds(messages, "arkcli")).toEqual(["a1"]);
  });
});
