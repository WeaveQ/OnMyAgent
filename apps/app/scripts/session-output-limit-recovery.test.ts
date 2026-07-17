import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import type { UIMessage } from "ai";

import {
  OUTPUT_LIMIT_CONTINUATION_MESSAGE_PREFIX,
  buildOutputLimitContinuationDraft,
  isOutputLimitContinuationMessageId,
  latestOutputLimitedAssistantMessage,
} from "../src/react-app/domains/session/sync/output-limit-recovery";
import { createTranscriptMessageMetadata } from "../src/react-app/domains/session/sync/message-metadata";
import { normalizeUiFinishReason } from "../src/react-app/domains/session/sync/usechat-adapter";

function message(id: string, role: UIMessage["role"], finish?: string): UIMessage {
  return {
    id,
    role,
    metadata: createTranscriptMessageMetadata({ finish }),
    parts: [{ type: "text", text: id }],
  };
}

describe("output-limit recovery", () => {
  test("normalizes provider output-limit reasons without reporting a normal stop", () => {
    expect(normalizeUiFinishReason("length")).toBe("length");
    expect(normalizeUiFinishReason("max_tokens")).toBe("length");
    expect(normalizeUiFinishReason("stop")).toBe("stop");
  });

  test("offers continuation only when the final conversation message hit the output limit", () => {
    const limited = message("assistant-limited", "assistant", "length");
    expect(latestOutputLimitedAssistantMessage([
      message("user", "user"),
      limited,
    ])?.id).toBe("assistant-limited");

    expect(latestOutputLimitedAssistantMessage([
      message("user", "user"),
      limited,
      message("next-user", "user"),
    ])).toBeNull();
    expect(latestOutputLimitedAssistantMessage([
      message("user", "user"),
      message("assistant-stop", "assistant", "stop"),
    ])).toBeNull();
  });

  test("builds a tagged continuation turn with a bounded-write recovery instruction", () => {
    const draft = buildOutputLimitContinuationDraft({
      messageID: `${OUTPUT_LIMIT_CONTINUATION_MESSAGE_PREFIX}test`,
      prompt: "Please resume the unfinished tasks.",
      hiddenSystemPrompt: "Continue exactly where the previous response stopped.",
    });

    expect(isOutputLimitContinuationMessageId(draft.messageID)).toBe(true);
    expect(draft.text).toBe("Please resume the unfinished tasks.");
    expect(draft.parts).toEqual([
      { type: "text", text: "Please resume the unfinished tasks." },
    ]);
    expect(draft.hiddenSystemPrompt).toContain("previous response stopped");
  });

  test("default agent requires bounded incremental writes for large artifacts", async () => {
    const source = await readFile(new URL("../../../.opencode/agents/onmyagent.md", import.meta.url), "utf8");
    expect(source).toContain("Keep each file-mutation tool call bounded");
    expect(source).toContain("write a small skeleton first");
    expect(source).toContain("edit or append in multiple calls");
  });

  test("session surface renders and sends the output-limit continuation card", async () => {
    const source = await readFile(
      new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url),
      "utf8",
    );
    const cardSource = await readFile(
      new URL("../src/react-app/domains/session/surface/chrome/assistant-status.tsx", import.meta.url),
      "utf8",
    );
    const transcriptSource = await readFile(
      new URL("../src/react-app/domains/session/surface/message-list.tsx", import.meta.url),
      "utf8",
    );
    const fixtureSource = await readFile(
      new URL("./session-transcript-visual-fixture.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("latestOutputLimitedAssistantMessage(renderedMessages)");
    expect(source).toContain("buildOutputLimitContinuationDraft({");
    expect(source).toContain("await props.onSendDraft(continuationDraft)");
    expect(source).toContain("<OutputLimitContinueCard");
    expect(cardSource).toContain('t("session.output_limit_continue_title")');
    expect(cardSource).toContain('t("session.output_limit_continue_action")');
    expect(transcriptSource).toContain('data-output-limit-continuation="true"');
    expect(fixtureSource).toContain("<OutputLimitContinueCard");
  });
});
