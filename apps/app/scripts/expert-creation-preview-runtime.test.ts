import { describe, expect, test } from "bun:test";

import {
  applyExpertPreviewStreamEvent,
  createExpertPreviewStreamState,
} from "../src/react-app/domains/agents/expert-creation-preview-runtime";

describe("expert creation preview stream", () => {
  test("streams only assistant text for the preview session", () => {
    const state = createExpertPreviewStreamState();
    const sessionId = "preview-session";
    applyExpertPreviewStreamEvent({
      type: "message.updated",
      properties: { info: { id: "assistant", role: "assistant", sessionID: sessionId } },
    }, sessionId, state);
    expect(applyExpertPreviewStreamEvent({
      type: "message.part.updated",
      properties: { part: { id: "part", messageID: "assistant", sessionID: sessionId, type: "text", text: "Hello" } },
    }, sessionId, state)).toEqual({ kind: "continue", text: "Hello" });
    expect(applyExpertPreviewStreamEvent({
      type: "message.part.delta",
      properties: { partID: "part", messageID: "assistant", sessionID: sessionId, field: "text", delta: " there" },
    }, sessionId, state)).toEqual({ kind: "continue", text: "Hello there" });
    expect(applyExpertPreviewStreamEvent({
      type: "session.idle",
      properties: { sessionID: sessionId },
    }, sessionId, state)).toEqual({ kind: "done", text: "Hello there" });
  });

  test("ignores user and unrelated session events", () => {
    const state = createExpertPreviewStreamState();
    applyExpertPreviewStreamEvent({
      type: "message.updated",
      properties: { info: { id: "user", role: "user", sessionID: "preview" } },
    }, "preview", state);
    expect(applyExpertPreviewStreamEvent({
      type: "message.part.updated",
      properties: { part: { id: "part", messageID: "user", sessionID: "preview", type: "text", text: "Question" } },
    }, "preview", state)).toBeNull();
    expect(applyExpertPreviewStreamEvent({
      type: "session.idle",
      properties: { sessionID: "other" },
    }, "preview", state)).toBeNull();
  });

  test("replays text events that arrive before the assistant role", () => {
    const state = createExpertPreviewStreamState();
    expect(applyExpertPreviewStreamEvent({
      type: "message.part.updated",
      properties: { part: { id: "part", messageID: "late-role", sessionID: "preview", type: "text", text: "Ready" } },
    }, "preview", state)).toBeNull();
    expect(applyExpertPreviewStreamEvent({
      type: "message.updated",
      properties: { info: { id: "late-role", role: "assistant", sessionID: "preview" } },
    }, "preview", state)).toEqual({ kind: "continue", text: "Ready" });
  });
});
