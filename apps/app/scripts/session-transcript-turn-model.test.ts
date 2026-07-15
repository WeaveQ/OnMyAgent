import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import type { OnMyAgentSessionSnapshot } from "../src/app/lib/onmyagent-server";
import {
  createTranscriptMessageMetadata,
  readTranscriptMessageMetadata,
} from "../src/react-app/domains/session/sync/message-metadata";
import { snapshotToUIMessages } from "../src/react-app/domains/session/sync/usechat-adapter";
import { buildTranscriptTurns } from "../src/react-app/domains/session/surface/transcript/turn-model";

function message(
  id: string,
  role: UIMessage["role"],
  metadata?: UIMessage["metadata"],
  parts: UIMessage["parts"] = [],
): UIMessage {
  return { id, role, ...(metadata === undefined ? {} : { metadata }), parts };
}

describe("session transcript turn model", () => {
  test("groups assistant-only output and user-led turns", () => {
    const turns = buildTranscriptTurns(
      [
        message("assistant-preface", "assistant"),
        message("user-1", "user"),
        message("assistant-1a", "assistant"),
        message("system-1", "system"),
        message("assistant-1b", "assistant"),
        message("user-2", "user"),
      ],
      { isStreaming: false },
    );

    expect(turns.map((turn) => turn.messages.map((item) => item.id))).toEqual([
      ["assistant-preface"],
      ["user-1", "assistant-1a", "system-1", "assistant-1b"],
      ["user-2"],
    ]);
    expect(turns[0]?.userMessage).toBeNull();
    expect(turns[1]?.actionMessageId).toBe("assistant-1b");
    expect(turns[2]?.state).toBe("pending");
  });

  test("derives duration and terminal states from normalized metadata", () => {
    const completed = buildTranscriptTurns(
      [
        message("user", "user", createTranscriptMessageMetadata({ time: { created: 1_000 } })),
        message("assistant", "assistant", createTranscriptMessageMetadata({ time: { created: 1_100, completed: 8_000 } })),
      ],
      { isStreaming: false },
    )[0];
    expect(completed?.state).toBe("completed");
    expect(completed?.durationMs).toBe(7_000);

    const cancelled = buildTranscriptTurns(
      [
        message("user", "user"),
        message("assistant", "assistant", createTranscriptMessageMetadata({ error: { name: "MessageAbortedError" } })),
      ],
      { isStreaming: true },
    )[0];
    expect(cancelled?.state).toBe("cancelled");

    const failed = buildTranscriptTurns(
      [
        message("user", "user"),
        message("assistant", "assistant", createTranscriptMessageMetadata({ error: { name: "APIError" } })),
      ],
      { isStreaming: true },
    )[0];
    expect(failed?.state).toBe("failed");

    const toolFailed = buildTranscriptTurns(
      [
        message("user", "user"),
        message("assistant", "assistant", undefined, [
          {
            type: "dynamic-tool",
            toolName: "shell",
            toolCallId: "tool-1",
            state: "output-error",
            input: {},
            errorText: "failed",
          },
        ]),
      ],
      { isStreaming: false },
    )[0];
    expect(toolFailed?.state).toBe("failed");
  });

  test("marks only the latest active turn as waiting or streaming", () => {
    const messages = [
      message("user-1", "user"),
      message("assistant-1", "assistant"),
      message("user-2", "user"),
    ];
    expect(buildTranscriptTurns(messages, { isStreaming: true }).map((turn) => turn.state)).toEqual([
      "completed",
      "streaming",
    ]);
    expect(
      buildTranscriptTurns(messages, { isStreaming: true, hasPendingApproval: true }).map(
        (turn) => turn.state,
      ),
    ).toEqual(["completed", "awaiting-approval"]);
  });

  test("round-trips model, cost, token, and error metadata", () => {
    const metadata = createTranscriptMessageMetadata({
      time: { created: 1_000, completed: 2_000 },
      providerID: "openai",
      modelID: "gpt-5",
      cost: 0.125,
      tokens: {
        total: 42,
        input: 20,
        output: 22,
        reasoning: 4,
        cache: { read: 5, write: 6 },
      },
      error: { name: "APIError" },
    });

    expect(readTranscriptMessageMetadata(metadata)).toEqual({
      created: 1_000,
      completed: 2_000,
      providerID: "openai",
      modelID: "gpt-5",
      cost: 0.125,
      tokens: {
        total: 42,
        input: 20,
        output: 22,
        reasoning: 4,
        cacheRead: 5,
        cacheWrite: 6,
      },
      errorName: "APIError",
    });
  });

  test("preserves rich assistant metadata from session snapshots", () => {
    const snapshot: OnMyAgentSessionSnapshot = {
      session: {
        id: "session-a",
        slug: "session-a",
        projectID: "project-a",
        directory: "/tmp/project-a",
        title: "Session A",
        version: "1",
        time: { created: 500, updated: 2_000 },
      },
      messages: [
        {
          info: {
            id: "assistant",
            sessionID: "session-a",
            role: "assistant",
            time: { created: 1_000, completed: 2_000 },
            parentID: "user",
            modelID: "gpt-5",
            providerID: "openai",
            mode: "chat",
            agent: "assistant",
            path: { cwd: "/tmp/project-a", root: "/tmp/project-a" },
            cost: 0.25,
            tokens: {
              total: 30,
              input: 10,
              output: 20,
              reasoning: 3,
              cache: { read: 4, write: 5 },
            },
          },
          parts: [
            {
              id: "part-text",
              sessionID: "session-a",
              messageID: "assistant",
              type: "text",
              text: "Done",
            },
          ],
        },
      ],
      todos: [],
      status: { type: "idle" },
    };

    const metadata = readTranscriptMessageMetadata(
      snapshotToUIMessages(snapshot)[0]?.metadata,
    );
    expect(metadata.providerID).toBe("openai");
    expect(metadata.modelID).toBe("gpt-5");
    expect(metadata.cost).toBe(0.25);
    expect(metadata.tokens?.total).toBe(30);
    expect(metadata.completed).toBe(2_000);
  });
});
