import { describe, expect, test } from "bun:test";

import type { OnMyAgentSessionSnapshot } from "../src/app/lib/onmyagent-server";
import { readSnapshotSessionError } from "../src/react-app/domains/session/surface/session-surface-support";

import {
  extractAssistantMessageErrorText,
  humanizeSessionErrorMessage,
  parseSessionError,
} from "../src/react-app/domains/session/surface/session-surface-support";

describe("humanizeSessionErrorMessage quota / plan", () => {
  test("maps token-plan quota exhaustion to a clear user message", () => {
    const raw =
      "AI_APICallError: Your token-plan 1-week quota has been exhausted. The quota will reset at 08-15 06:20:00 UTC.";
    const humanized = humanizeSessionErrorMessage(raw);
    expect(humanized).not.toContain("AI_APICallError");
    expect(humanized.toLowerCase()).toMatch(/quota|额度|額度|plan|套餐/);
  });

  test("maps Expert runtime contract violations to localized product copy", () => {
    const humanized = humanizeSessionErrorMessage(
      '{"code":"expert_runtime_contract_violated"}',
    );
    expect(humanized).not.toContain("expert_runtime_contract_violated");
    expect(humanized).toMatch(/Expert runtime|专家运行环境|專家執行環境/);
  });

  test("uses the typed server code even when its message is generic", () => {
    const parsed = parseSessionError(JSON.stringify({
      code: "expert_runtime_contract_violated",
      message: "The selected agent is not declared by this package",
    }));
    expect(parsed.code).toBe("expert_runtime_contract_violated");
    expect(parsed.message).not.toContain("selected agent");
    expect(parsed.message).toMatch(/Expert runtime|专家运行环境|專家執行環境|不允许|不允許/);
  });

  test("maps prompt_body_too_large to attachment copy, not text-split copy", () => {
    const parsed = parseSessionError(JSON.stringify({
      code: "expert_runtime_contract_violated",
      details: { violationCode: "prompt_body_too_large" },
    }));
    expect(parsed.message).toMatch(/attachment|附件|檔案/i);
    expect(parsed.message).not.toMatch(/split the text|拆分文字/);
  });

  test("maps prompt_agent_not_allowed to agent-specific copy", () => {
    const parsed = parseSessionError(JSON.stringify({
      code: "expert_runtime_contract_violated",
      details: { violationCode: "prompt_agent_not_allowed" },
    }));
    expect(parsed.message).toMatch(/agent|Agent|对话|對話/i);
    expect(parsed.message).not.toMatch(/不安全/);
  });
});

describe("extractAssistantMessageErrorText", () => {
  test("reads nested data.message from API error envelopes", () => {
    expect(
      extractAssistantMessageErrorText({
        name: "UnknownError",
        data: {
          message:
            "Your token-plan 1-week quota has been exhausted. The quota will reset at 08-15 06:20:00 UTC.",
        },
      }),
    ).toContain("token-plan");
  });
});

describe("readSnapshotSessionError", () => {
  test("maps async quota errors into a humanized session error", () => {
    const snapshot = {
      session: { id: "session" },
      messages: [
        {
          info: {
            id: "assistant",
            sessionID: "session",
            role: "assistant",
            parentID: "user",
            modelID: "deepseek-v4-flash-0731",
            providerID: "aliyuncs",
            mode: "build",
            agent: "assistant",
            path: { cwd: "/", root: "/" },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            time: { created: 1, completed: 2 },
            error: {
              name: "UnknownError",
              data: {
                message:
                  "Your token-plan 1-week quota has been exhausted. The quota will reset at 08-15 06:20:00 UTC.",
              },
            },
          },
          parts: [],
        },
      ],
      todos: [],
      status: { type: "idle" },
    } satisfies OnMyAgentSessionSnapshot;

    const err = readSnapshotSessionError(snapshot);
    expect(err).not.toBeNull();
    expect(err!.message.toLowerCase()).toMatch(/quota|额度|額度|plan|套餐/);
    expect(err!.createdAt).toBe(1);
  });

  test("extracts asynchronous assistant API errors", () => {
    const snapshot = {
      session: { id: "session" },
      messages: [
        {
          info: {
            id: "assistant",
            sessionID: "session",
            role: "assistant",
            parentID: "user",
            modelID: "model",
            providerID: "provider",
            mode: "build",
            agent: "assistant",
            path: { cwd: "/", root: "/" },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            time: { created: 1, completed: 2 },
            error: {
              name: "APIError",
              data: { message: "Model access denied." },
            },
          },
          parts: [],
        },
      ],
      todos: [],
      status: { type: "idle" },
    } satisfies OnMyAgentSessionSnapshot;

    expect(readSnapshotSessionError(snapshot)).toEqual({
      message: "Model access denied.",
      createdAt: 1,
    });
  });

  test("preserves WorkBuddy-style diagnostic identifiers from API errors", () => {
    const snapshot = {
      session: { id: "session" },
      messages: [
        {
          info: {
            id: "assistant",
            sessionID: "session",
            role: "assistant",
            parentID: "user",
            modelID: "model",
            providerID: "provider",
            mode: "build",
            agent: "assistant",
            path: { cwd: "/", root: "/" },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            time: { created: 1_000, completed: 2_000 },
            error: {
              name: "APIError",
              data: {
                message: "Provider rejected the request.",
                code: 429,
                requestId: "request-123",
                traceId: "trace-456",
              },
            },
          },
          parts: [],
        },
      ],
      todos: [],
      status: { type: "idle" },
    } satisfies OnMyAgentSessionSnapshot;

    expect(readSnapshotSessionError(snapshot)).toEqual({
      message: "Provider rejected the request.",
      code: "429",
      messageId: "request-123",
      traceId: "trace-456",
      createdAt: 1_000,
    });
  });

  test("returns null when the assistant has no error", () => {
    const snapshot = {
      session: { id: "session" },
      messages: [],
      todos: [],
      status: { type: "idle" },
    } satisfies OnMyAgentSessionSnapshot;

    expect(readSnapshotSessionError(snapshot)).toBeNull();
  });

  test("does not repeat an old error after a newer user turn", () => {
    const snapshot = {
      session: { id: "session" },
      messages: [
        {
          info: {
            id: "assistant",
            sessionID: "session",
            role: "assistant",
            parentID: "user",
            modelID: "model",
            providerID: "provider",
            mode: "build",
            agent: "assistant",
            path: { cwd: "/", root: "/" },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            time: { created: 1, completed: 2 },
            error: {
              name: "APIError",
              data: { message: "Model access denied." },
            },
          },
          parts: [],
        },
        {
          info: {
            id: "user-next",
            sessionID: "session",
            role: "user",
            time: { created: 3 },
            agent: "assistant",
            model: { providerID: "provider", modelID: "model" },
          },
          parts: [],
        },
      ],
      todos: [],
      status: { type: "busy" },
    } satisfies OnMyAgentSessionSnapshot;

    expect(readSnapshotSessionError(snapshot)).toBeNull();
  });
});
