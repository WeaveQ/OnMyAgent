import { describe, expect, test } from "bun:test";
import type { ChatMessage } from "../src/react-app/domains/local-agents/messages/message-types";
import { hasOptimisticUserMessageForRun } from "../src/react-app/domains/local-agents/host/personal-local-agent-page-helpers";

function messagesWithOptimisticUser(text: string): ChatMessage[] {
  return [
    { id: "user-local", role: "user", text, createdAt: 1 },
    { id: "assistant-run", role: "assistant", text: "正在调用…", createdAt: 2 },
  ];
}

describe("personal local-agent user-message dedupe", () => {
  test("recognizes the optimistic user bubble directly before the run assistant", () => {
    const messages = messagesWithOptimisticUser("你好");
    expect(hasOptimisticUserMessageForRun(messages, 1, "你好")).toBe(true);
  });

  test("does not treat an older same-text turn as the current optimistic bubble", () => {
    const messages: ChatMessage[] = [
      { id: "old-user", role: "user", text: "你好", createdAt: 1 },
      { id: "old-assistant", role: "assistant", text: "好的", createdAt: 2 },
      { id: "assistant-run", role: "assistant", text: "正在调用…", createdAt: 3 },
    ];
    expect(hasOptimisticUserMessageForRun(messages, 2, "你好")).toBe(false);
  });

  test("keeps channel-run hydration able to insert a missing user bubble", () => {
    const messages: ChatMessage[] = [
      { id: "assistant-run", role: "assistant", text: "正在调用…", createdAt: 2 },
    ];
    expect(hasOptimisticUserMessageForRun(messages, 0, "你好")).toBe(false);
  });
});
