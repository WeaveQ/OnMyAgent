import { describe, expect, test } from "bun:test";

import type { OnMyAgentSessionSnapshot } from "../src/app/lib/onmyagent-server";
import { readSnapshotSessionError } from "../src/react-app/domains/session/surface/session-surface-support";

describe("readSnapshotSessionError", () => {
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
