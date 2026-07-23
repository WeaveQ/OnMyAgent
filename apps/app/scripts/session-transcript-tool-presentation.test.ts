import { describe, expect, test } from "bun:test";

import { buildTranscriptToolPresentation } from "../src/react-app/domains/session/surface/transcript/tool-presentation";

describe("session transcript specialized tool presentation", () => {
  test("keeps read rows to one filename headline and a line range", () => {
    expect(buildTranscriptToolPresentation({
      toolName: "read_file",
      toolInput: { filePath: "src/app.ts", startLine: 12, endLine: 48 },
      toolOutput: { content: "..." },
    })).toMatchObject({
      family: "read",
      secondary: null,
      lineRange: "L12-48",
    });
  });

  test("extracts command text and patch line statistics", () => {
    expect(buildTranscriptToolPresentation({
      toolName: "bash",
      toolInput: { command: "pnpm task check app" },
      toolOutput: "passed",
    })).toMatchObject({
      family: "command",
      secondary: "pnpm task check app",
    });
    expect(buildTranscriptToolPresentation({
      toolName: "apply_patch",
      toolInput: { patchText: "@@\n-old\n+new\n+added" },
      toolOutput: "done",
    })).toMatchObject({
      family: "write",
      addedLines: 2,
      removedLines: 1,
    });
  });

  test("extracts search query without inventing file metadata", () => {
    expect(buildTranscriptToolPresentation({
      toolName: "grep",
      toolInput: { pattern: "SessionTranscript" },
      toolOutput: ["message-list.tsx"],
    })).toMatchObject({
      family: "search",
      secondary: "SessionTranscript",
      lineRange: null,
    });
  });
});
