import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ApiError } from "../src/core/errors.js";
import {
  AGENT_RUNTIME_PROMPT_AGGREGATE_MAX_BYTES,
  assertPromptAggregateWithinBudget,
  measurePromptAggregateBytes,
  parsePromptPart,
  parsePromptParts,
  publishedAgentRuntimePromptPartTypes,
} from "../src/services/agent-runtime-prompt-parts.js";

const typeSource = readFileSync(
  join(import.meta.dir, "../../../packages/types/src/agent-runtime.ts"),
  "utf8",
);
const routeSource = readFileSync(
  join(import.meta.dir, "../src/routes/agent-runtime-routes.ts"),
  "utf8",
);

const publishedKinds = [...typeSource.matchAll(/type:\s*"([a-z_]+)"/g)]
  .map((match) => match[1])
  .filter((kind, index, all) => {
    const block = typeSource.slice(
      typeSource.indexOf("export type AgentRuntimePromptPartInput"),
      typeSource.indexOf("export type AgentRuntimePromptInput"),
    );
    return block.includes(`type: "${kind}"`) && all.indexOf(kind) === index;
  });

describe("parsePromptParts production HTTP parser", () => {
  test("covers every published AgentRuntimePromptPartInput kind", () => {
    expect(publishedKinds.sort()).toEqual(
      [...publishedAgentRuntimePromptPartTypes].sort(),
    );
    expect(routeSource).toContain(
      'from "../services/agent-runtime-prompt-parts.js"',
    );
    expect(routeSource).toContain("parsePromptParts(body.parts)");
  });

  test("round-trips one representative of each published kind", () => {
    const parts = parsePromptParts([
      { type: "text", text: "hello" },
      { type: "file", url: "https://example.test/a.png", filename: "a.png", mime: "image/png" },
      { type: "resource_link", uri: "file:///tmp/notes.md", filename: "notes.md", mime: "text/markdown" },
      { type: "staged_file", path: "/tmp/staged.txt", filename: "staged.txt", mime: "text/plain" },
      { type: "image", path: "/tmp/shot.png", mime: "image/png" },
      { type: "agent", name: "reviewer" },
    ]);
    expect(parts.map((part) => part.type)).toEqual([
      "text",
      "file",
      "resource_link",
      "staged_file",
      "image",
      "agent",
    ]);
    expect(parts[0]).toEqual({ type: "text", text: "hello" });
    expect(parts[1]).toMatchObject({ type: "file", url: "https://example.test/a.png", mime: "image/png" });
    expect(parts[2]).toMatchObject({ type: "resource_link", uri: "file:///tmp/notes.md" });
    expect(parts[3]).toMatchObject({ type: "staged_file", path: "/tmp/staged.txt" });
    expect(parts[4]).toMatchObject({ type: "image", path: "/tmp/shot.png" });
    expect(parts[5]).toEqual({ type: "agent", name: "reviewer" });
  });

  test("rejects staged paths that climb out of the staging tree", () => {
    expect(() => parsePromptPart({
      type: "staged_file",
      path: "/tmp/ok/../../etc/passwd",
    })).toThrow(ApiError);
  });

  test("rejects aggregated prompt text and parts over the byte cap", () => {
    const parts = parsePromptParts([
      { type: "text", text: "a".repeat(300 * 1024) },
      { type: "text", text: "b".repeat(300 * 1024) },
    ]);
    expect(measurePromptAggregateBytes({ text: "ok", parts }))
      .toBeGreaterThan(AGENT_RUNTIME_PROMPT_AGGREGATE_MAX_BYTES);
    expect(() => assertPromptAggregateWithinBudget({ text: "ok", parts }))
      .toThrow(expect.objectContaining({ code: "payload_too_large" }));
    expect(() => assertPromptAggregateWithinBudget({ text: "hello" })).not.toThrow();
  });

  test("rejects unknown kinds", () => {
    expect(() => parsePromptPart({ type: "audio", url: "x" })).toThrow(ApiError);
    try {
      parsePromptParts([{ type: "not-a-kind", text: "x" }]);
      throw new Error("expected reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("invalid_payload");
    }
  });
});
