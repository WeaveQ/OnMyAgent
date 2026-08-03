import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";

import {
  addOptimisticSessionUserMessage,
  removeOptimisticSessionUserMessage,
} from "../src/react-app/domains/session/sync/optimistic-session-user-message";

function message(id: string, role: "user" | "assistant", text: string): UIMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text, state: "done" }],
  };
}

describe("optimistic session user messages", () => {
  it("shows the first user prompt immediately", () => {
    const next = addOptimisticSessionUserMessage([], {
      messageId: "msg_first",
      text: "first prompt",
      createdAt: 42,
    });

    expect(next).toEqual([
      {
        id: "msg_first",
        role: "user",
        metadata: { opencode: { created: 42 } },
        parts: [{ type: "text", text: "first prompt", state: "done" }],
      },
    ]);
  });

  it("does not duplicate a message already delivered by the runtime", () => {
    const current = [message("msg_first", "user", "server prompt")];

    expect(
      addOptimisticSessionUserMessage(current, {
        messageId: "msg_first",
        text: "first prompt",
        createdAt: 42,
      }),
    ).toBe(current);
  });

  it("removes only the failed optimistic prompt", () => {
    const assistant = message("msg_assistant", "assistant", "answer");
    const current = [message("msg_first", "user", "first prompt"), assistant];

    expect(removeOptimisticSessionUserMessage(current, "msg_first")).toEqual([
      assistant,
    ]);
  });
});
