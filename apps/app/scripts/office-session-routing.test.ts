import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildOfficeCreateSessionInput,
  resolveOfficePromptDispatch,
  shouldUsePiSessionWriteShim,
} from "../src/app/lib/office-session-routing";

const officeClientSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/app/lib/opencode.ts"),
  "utf8",
);

const fullPrompt = {
  sessionID: "ses_office",
  directory: "/workspace/office/.experts/a",
  model: { providerID: "openai", modelID: "gpt-4.1" },
  agent: "build",
  tools: { bash: true },
  parts: [
    { type: "text", text: "hello" },
    { type: "file", url: "file:///tmp/note.md" },
  ],
};

describe("office session create/prompt routing", () => {
  test("OpenCode and missing engine stay on sdk-prompt-async", () => {
    expect(shouldUsePiSessionWriteShim(undefined)).toBe(false);
    expect(shouldUsePiSessionWriteShim("opencode")).toBe(false);
    expect(resolveOfficePromptDispatch(undefined, fullPrompt)).toEqual({
      kind: "sdk-prompt-async",
    });
    expect(resolveOfficePromptDispatch("opencode", fullPrompt)).toEqual({
      kind: "sdk-prompt-async",
    });
  });

  test("old onmyagent-always-text-only prompt would fail the OpenCode contract", () => {
    const oldBroken = (_engine: unknown, parameters: { parts?: unknown[] }) => {
      const parts = parameters.parts;
      const text = Array.isArray(parts)
        ? parts
            .map((part) => {
              if (!part || typeof part !== "object") return "";
              const record = part as { type?: unknown; text?: unknown };
              return record.type === "text" && typeof record.text === "string" ? record.text : "";
            })
            .filter(Boolean)
            .join("\n")
        : "";
      return { kind: "pi-text" as const, text };
    };
    expect(oldBroken("opencode", fullPrompt).kind).toBe("pi-text");
    expect(resolveOfficePromptDispatch("opencode", fullPrompt).kind).not.toBe("pi-text");
    expect(resolveOfficePromptDispatch("opencode", fullPrompt).kind).toBe("sdk-prompt-async");
  });

  test("Pi shim is the only path that concatenates text parts", () => {
    expect(shouldUsePiSessionWriteShim("pi")).toBe(true);
    expect(resolveOfficePromptDispatch("pi", fullPrompt)).toEqual({
      kind: "pi-text",
      text: "hello",
    });
  });

  test("create input keeps directory and title", () => {
    expect(
      buildOfficeCreateSessionInput({
        directory: "/workspace/office/.experts/a",
        title: "Kickoff",
        agent: "build",
      }),
    ).toEqual({
      directory: "/workspace/office/.experts/a",
      title: "Kickoff",
      agentId: "build",
    });
  });

  test("office client uses the shipped routing helpers instead of a text-only prompt", () => {
    expect(officeClientSource).toContain("shouldUsePiSessionWriteShim");
    expect(officeClientSource).toContain("resolveOfficePromptDispatch");
    expect(officeClientSource).toContain("buildOfficeCreateSessionInput");
    expect(officeClientSource).toContain("promptAsyncOriginal");
    expect(officeClientSource).not.toContain("route every prompt through the engine-agnostic");
    expect(officeClientSource).not.toMatch(
      /onmyagentSessionClient\.sendPrompt\([\s\S]*join\("\\n"\)/,
    );
  });
});
