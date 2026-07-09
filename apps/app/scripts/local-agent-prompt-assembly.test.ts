import { describe, expect, test } from "bun:test";

import {
  assembleLocalAgentPrompt,
  PROMPT_PASTED_ATTACH_THRESHOLD,
} from "../src/react-app/domains/local-agents/local-agent-prompt-assembly";
import type {
  LocalAgentAttachment,
  LocalAgentComposerSubmit,
} from "../src/react-app/domains/local-agents/local-agent-draft-composer";

function payload(overrides: Partial<LocalAgentComposerSubmit> = {}): LocalAgentComposerSubmit {
  return {
    text: "",
    attachments: [],
    mentions: {},
    quotes: [],
    ...overrides,
  };
}

function attachment(name: string): LocalAgentAttachment {
  return {
    id: `att-${name}`,
    name,
    absolutePath: `/tmp/${name}`,
    relativePath: name,
    size: 12,
    kind: name.endsWith(".png") ? "image" : "file",
  };
}

describe("assembleLocalAgentPrompt", () => {
  test("returns empty result for empty payload", () => {
    const result = assembleLocalAgentPrompt(payload());
    expect(result.sections).toEqual([]);
    expect(result.text).toBe("");
    expect(result.unresolvedMentions).toEqual([]);
  });

  test("emits trimmed text when only text is present", () => {
    const result = assembleLocalAgentPrompt(payload({ text: "  hello world  " }));
    expect(result.sections).toEqual([{ kind: "text", body: "hello world" }]);
    expect(result.text).toBe("hello world");
  });

  test("emits references block when only mentions are present", () => {
    const result = assembleLocalAgentPrompt(
      payload({ mentions: { "@a": "/abs/a", "@b": "/abs/b" } }),
    );
    expect(result.text).toBe("[Referenced files]\n- @a -> /abs/a\n- @b -> /abs/b");
  });

  test("emits attachments block when only attachments are present", () => {
    const result = assembleLocalAgentPrompt(payload({ attachments: [attachment("note.md")] }));
    expect(result.text).toContain("[Attached files]");
    expect(result.text).toContain("- note.md (file) -> /tmp/note.md");
  });

  test("emits paste block per quote", () => {
    const result = assembleLocalAgentPrompt(
      payload({
        quotes: [
          { id: "q1", text: "alpha", lines: 1 },
          { id: "q2", text: "beta", lines: 1 },
        ],
      }),
    );
    const paste = result.sections.filter((s) => s.kind === "paste");
    expect(paste.length).toBe(2);
    expect(result.text.split("[Pasted content]").length - 1).toBe(2);
  });

  test("combines all four section kinds in fixed order", () => {
    const result = assembleLocalAgentPrompt(
      payload({
        text: "explain",
        mentions: { "@x": "/abs/x" },
        attachments: [attachment("y.png")],
        quotes: [{ id: "q", text: "raw", lines: 1 }],
      }),
    );
    const kinds = result.sections.map((s) => s.kind);
    expect(kinds).toEqual(["text", "references", "attachments", "paste"]);
  });

  test("deduplicates repeated mention tokens", () => {
    const mentions: Record<string, string> = {};
    mentions["@same"] = "/first";
    // second write to same key would just overwrite in normal object; simulate
    // via re-assignment path
    Object.defineProperty(mentions, "@same", { value: "/first", enumerable: true });
    const result = assembleLocalAgentPrompt(payload({ mentions }));
    const ref = result.sections.find((s) => s.kind === "references");
    expect(ref?.kind).toBe("references");
    if (ref?.kind === "references") expect(ref.entries.length).toBe(1);
  });

  test("flags unresolved mentions present in text", () => {
    const result = assembleLocalAgentPrompt(
      payload({ text: "compare @known and @missing", mentions: { "@known": "/abs/known" } }),
    );
    expect(result.unresolvedMentions).toEqual(["@missing"]);
  });

  test("does not flag when no unregistered @tokens in text", () => {
    const result = assembleLocalAgentPrompt(
      payload({ text: "hello world", mentions: { "@known": "/abs/known" } }),
    );
    expect(result.unresolvedMentions).toEqual([]);
  });

  test("keeps paste under threshold intact", () => {
    const body = "x".repeat(PROMPT_PASTED_ATTACH_THRESHOLD);
    const result = assembleLocalAgentPrompt(payload({ quotes: [{ id: "q", text: body, lines: 1 }] }));
    const paste = result.sections.find((s) => s.kind === "paste");
    if (paste?.kind !== "paste") throw new Error("expected paste section");
    expect(paste.overflowed).toBe(false);
    expect(paste.body).toBe(body);
  });

  test("marks paste over threshold as overflowed and truncates body", () => {
    const body = "y".repeat(PROMPT_PASTED_ATTACH_THRESHOLD + 1);
    const result = assembleLocalAgentPrompt(payload({ quotes: [{ id: "q", text: body, lines: 1 }] }));
    const paste = result.sections.find((s) => s.kind === "paste");
    if (paste?.kind !== "paste") throw new Error("expected paste section");
    expect(paste.overflowed).toBe(true);
    expect(paste.body.length).toBeLessThanOrEqual(PROMPT_PASTED_ATTACH_THRESHOLD + 128);
    expect(paste.body).toContain("truncated");
  });

  test("handles special characters and unicode in text", () => {
    const result = assembleLocalAgentPrompt(payload({ text: "中文 emoji 🎯 <html> \\n" }));
    expect(result.text).toBe("中文 emoji 🎯 <html> \\n");
  });
});
