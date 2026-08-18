import { describe, expect, test } from "bun:test";
import {
  CROSS_RUNTIME_FORK_CONTEXT_CHAR_LIMIT,
  clipCrossRuntimeForkContext,
} from "../src/services/cross-runtime-fork-context.js";

describe("clipCrossRuntimeForkContext", () => {
  test("keeps the newest user message when the joined conversation exceeds 16k", () => {
    const oldest = "oldest-context-".repeat(800);
    const middle = "middle-context-".repeat(800);
    const newest = "UNIQUE_NEWEST_USER_QUESTION_XYZ";
    const clipped = clipCrossRuntimeForkContext([
      {
        role: "user",
        parts: [{ type: "text", text: oldest }],
      },
      {
        role: "assistant",
        parts: [{ type: "text", text: middle }],
      },
      {
        role: "user",
        parts: [{ type: "text", text: newest }],
      },
    ]);
    expect(`${oldest}\n${middle}\n${newest}`.length)
      .toBeGreaterThan(CROSS_RUNTIME_FORK_CONTEXT_CHAR_LIMIT);
    expect(clipped).toContain(newest);
    expect(clipped.startsWith("oldest-context-")).toBe(false);
    expect(clipped.length).toBeLessThanOrEqual(CROSS_RUNTIME_FORK_CONTEXT_CHAR_LIMIT);
  });

  test("reserves UNIQUE_NEWEST whole before a 15k later assistant", () => {
    const newest = "UNIQUE_NEWEST_USER_QUESTION_XYZ";
    const later = "a".repeat(15_000);
    const clipped = clipCrossRuntimeForkContext([
      {
        role: "user",
        parts: [{ type: "text", text: "oldest-context-".repeat(800) }],
      },
      {
        role: "user",
        parts: [{ type: "text", text: newest }],
      },
      {
        role: "assistant",
        parts: [{ type: "text", text: later }],
      },
    ]);
    expect(clipped.includes(newest)).toBe(true);
    expect(clipped.split("\n").includes(newest) || clipped === newest || clipped.startsWith(`${newest}\n`))
      .toBe(true);
    expect(clipped.length).toBeLessThanOrEqual(CROSS_RUNTIME_FORK_CONTEXT_CHAR_LIMIT);

    const overflowingLater = "a".repeat(CROSS_RUNTIME_FORK_CONTEXT_CHAR_LIMIT - 10);
    const reserved = clipCrossRuntimeForkContext([
      { role: "user", parts: [{ type: "text", text: newest }] },
      { role: "assistant", parts: [{ type: "text", text: overflowingLater }] },
    ]);
    expect(reserved).toBe(newest);
    expect(reserved.includes(newest)).toBe(true);
    expect(reserved.startsWith("a")).toBe(false);
  });
});
