import { describe, expect, test } from "bun:test";

import {
  applyExpertPreviewStreamEvent,
  buildExpertPreviewSystemPrompt,
  createExpertPreviewStreamState,
  readLatestExpertPreviewReply,
} from "../src/react-app/domains/agents/expert-creation-preview-runtime";
import { createBlankWizardDraft, createDefaultAgentRegistry } from "../src/react-app/domains/agents/agent-registry";

describe("expert creation preview stream", () => {
  test("recovers the latest assistant reply from the completed transcript", () => {
    expect(readLatestExpertPreviewReply([
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "Earlier answer" }],
      },
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "Latest question" }],
      },
      {
        info: { role: "assistant" },
        parts: [
          { type: "reasoning", text: "Hidden" },
          { type: "text", text: "Latest answer" },
        ],
      },
    ])).toBe("Latest answer");
  });

  test("includes staged knowledge files in the unsaved draft system prompt", () => {
    const draft = createBlankWizardDraft(createDefaultAgentRegistry());
    draft.name = "Research expert";
    draft.agentMemory = "Remember the project constraints.";
    const prompt = buildExpertPreviewSystemPrompt(draft, [
      "/tmp/expert-draft/knowledge/research/brief.md",
    ]);
    expect(prompt).toContain("Research expert");
    expect(prompt).toContain("Remember the project constraints.");
    expect(prompt).toContain("/tmp/expert-draft/knowledge/research/brief.md");
  });

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

  test("never exposes reasoning deltas that arrive before their part declaration", () => {
    const state = createExpertPreviewStreamState();
    applyExpertPreviewStreamEvent({
      type: "message.updated",
      properties: { info: { id: "assistant", role: "assistant", sessionID: "preview" } },
    }, "preview", state);
    expect(applyExpertPreviewStreamEvent({
      type: "message.part.delta",
      properties: {
        partID: "reasoning-part",
        messageID: "assistant",
        sessionID: "preview",
        field: "text",
        delta: "Private chain of thought",
      },
    }, "preview", state)).toBeNull();
    expect(applyExpertPreviewStreamEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-part",
          messageID: "assistant",
          sessionID: "preview",
          type: "reasoning",
          text: "Private chain of thought",
        },
      },
    }, "preview", state)).toBeNull();
    expect(applyExpertPreviewStreamEvent({
      type: "message.part.delta",
      properties: {
        partID: "text-part",
        messageID: "assistant",
        sessionID: "preview",
        field: "text",
        delta: "Public answer",
      },
    }, "preview", state)).toBeNull();
    expect(applyExpertPreviewStreamEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-part",
          messageID: "assistant",
          sessionID: "preview",
          type: "text",
          text: "Public answer",
        },
      },
    }, "preview", state)).toEqual({ kind: "continue", text: "Public answer" });
    expect(applyExpertPreviewStreamEvent({
      type: "session.idle",
      properties: { sessionID: "preview" },
    }, "preview", state)).toEqual({ kind: "done", text: "Public answer" });
  });
});
