import { describe, expect, test } from "bun:test";

import { isInternalAssistantNarration } from "../src/react-app/domains/session/surface/message-list";

describe("internal assistant narration", () => {
  test("hides provider planning narration while preserving a user-facing reply", () => {
    expect(isInternalAssistantNarration("The user wants me to continue.")).toBe(true);
    expect(isInternalAssistantNarration("The user's goal is set to reply briefly.")).toBe(true);
    expect(isInternalAssistantNarration("The user is continuing the conversation.")).toBe(true);
    expect(isInternalAssistantNarration("Let me inspect the workspace first.")).toBe(true);
    expect(isInternalAssistantNarration("你好呀！有什么我可以帮你的吗？")).toBe(false);
    expect(isInternalAssistantNarration("The implementation is complete.")).toBe(false);
  });
});
