import { describe, expect, test } from "bun:test";

import { readExpertCoachRuntimeEvent } from "../src/react-app/domains/agents/expert-creation-coach-runtime";

const sessionId = "session-coach";
const completeRolePrompt = [
  "## Expert overview\nServes product teams with research conclusions.",
  "## Core capabilities\nBreaks down problems and compares evidence.",
  "## Key rules\nConfirm goals and constraints first.",
  "## Prohibited behavior\nDo not invent facts or make unauthorized promises.",
  "## Workflow\nClarify, analyze, verify, and deliver.",
  "## Deliverable structure\nConclusion, evidence, risks, and next steps.",
  "## Communication style\nBe concise and lead with the conclusion.",
].join("\n\n");

describe("expert creation coach runtime events", () => {
  test("reads a completed native structured-output tool result", () => {
    expect(readExpertCoachRuntimeEvent({
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          tool: "StructuredOutput",
          sessionID: sessionId,
          state: {
            status: "completed",
            input: {
              reply: "I have enough detail to suggest a version.",
              proposal: {
                name: "Research partner",
                description: "Finds and compares evidence.",
                rolePrompt: completeRolePrompt,
                memory: "Remember preferred source types.",
                skillIds: ["research"],
              },
            },
          },
        },
      },
    }, sessionId)).toEqual({
      kind: "result",
      result: {
        reply: "I have enough detail to suggest a version.",
        proposal: {
          name: "Research partner",
          description: "Finds and compares evidence.",
          rolePrompt: completeRolePrompt,
          memory: "Remember preferred source types.",
          skillIds: ["research"],
        },
      },
    });
  });

  test("ignores other sessions and incomplete tool calls", () => {
    expect(readExpertCoachRuntimeEvent({
      type: "session.idle",
      properties: { sessionID: "other-session" },
    }, sessionId)).toBeNull();
    expect(readExpertCoachRuntimeEvent({
      type: "message.part.updated",
      properties: {
        part: {
          type: "tool",
          tool: "StructuredOutput",
          sessionID: sessionId,
          state: { status: "running", input: {} },
        },
      },
    }, sessionId)).toBeNull();
  });

  test("normalizes nested event envelopes and terminal events", () => {
    expect(readExpertCoachRuntimeEvent({
      payload: { type: "session.idle", properties: { sessionID: sessionId } },
    }, sessionId)).toEqual({ kind: "done" });
    expect(readExpertCoachRuntimeEvent({
      type: "session.error",
      properties: { sessionID: sessionId, error: { message: "Model unavailable" } },
    }, sessionId)).toEqual({ kind: "error", message: "Model unavailable" });
  });
});
