import { describe, expect, test } from "bun:test";

import { buildTranscriptToolPresentation } from "../src/react-app/domains/session/surface/transcript/tool-presentation";
import { specializedToolHeadline } from "../src/react-app/domains/session/surface/specialized-tool-details";

describe("session transcript WorkBuddy command and write results", () => {
  test("routes command and write details through dedicated transcript surfaces", async () => {
    const source = await Bun.file(new URL(
      "../src/react-app/domains/session/surface/specialized-tool-details.tsx",
      import.meta.url,
    )).text();

    expect(source).toContain('data-tool-details="command"');
    expect(source).toContain('data-tool-details="write"');
    expect(source).toContain('"session.tool_command_success"');
    expect(source).toContain('"session.tool_write_edit_index"');
  });

  test("normalizes nested execute-command output into a dedicated terminal result", () => {
    const presentation = buildTranscriptToolPresentation({
      toolName: "execute_command",
      toolInput: {
        command: "pnpm task check app",
        description: "Check the app types",
        requires_approval: true,
      },
      toolOutput: {
        result: {
          stdout: "Checking app...\nDone",
          stderr: "A warning",
          exit_code: 0,
          use_standalone_terminal: true,
        },
      },
    });

    expect(presentation.family).toBe("command");
    expect(presentation.details).toEqual({
      kind: "command",
      command: "pnpm task check app",
      description: "Check the app types",
      stdout: "Checking app...\nDone",
      stderr: "A warning",
      exitCode: 0,
      requiresApproval: true,
      standaloneTerminal: true,
    });
  });

  test("keeps a completed command with empty stdout as a specialized result", () => {
    const presentation = buildTranscriptToolPresentation({
      toolName: "bash",
      toolInput: { command: "true" },
      toolOutput: { result: { stdout: "", exit_code: 0 } },
    });

    expect(presentation.details).toMatchObject({
      kind: "command",
      command: "true",
      stdout: "",
      exitCode: 0,
    });
    if (presentation.details?.kind !== "command") throw new Error("Expected command details");
    expect(specializedToolHeadline(presentation.details, false)).toBe("true");
  });

  test("normalizes a replace operation into WorkBuddy diff lines and statistics", () => {
    const presentation = buildTranscriptToolPresentation({
      toolName: "replace_in_file",
      toolInput: {
        filePath: "/workspace/src/app.ts",
        old_str: "const mode = 'old';\nrun(mode);",
        new_str: "const mode = 'new';\nrun(mode);",
      },
      toolOutput: {
        result: {
          oldContent: "const mode = 'old';\nrun(mode);",
          addLineCount: 1,
          removedLines: 1,
        },
      },
    });

    expect(presentation.family).toBe("write");
    expect(presentation.addedLines).toBe(1);
    expect(presentation.removedLines).toBe(1);
    expect(presentation.details).toMatchObject({
      kind: "write",
      fileName: "app.ts",
      filePath: "/workspace/src/app.ts",
      operation: "modify",
      edits: [],
      omittedCount: 0,
      lines: [
        { kind: "removed", text: "const mode = 'old';" },
        { kind: "added", text: "const mode = 'new';" },
      ],
    });
  });

  test("normalizes WorkBuddy multi-edit payloads into separate diff sections", () => {
    const presentation = buildTranscriptToolPresentation({
      toolName: "multi_edit",
      toolInput: {
        filePath: "/workspace/src/app.ts",
        edits: [
          { oldString: "alpha", newString: "beta" },
          { oldString: "one\ntwo", newString: "one\nthree" },
          { oldString: "", newString: "" },
        ],
      },
      toolOutput: { result: {} },
    });

    expect(presentation.details?.kind).toBe("write");
    if (presentation.details?.kind !== "write") throw new Error("Expected write details");
    expect(presentation.details.edits).toHaveLength(2);
    expect(presentation.details.edits[0]).toMatchObject({
      addedLines: 1,
      removedLines: 1,
      lines: [
        { kind: "removed", text: "alpha" },
        { kind: "added", text: "beta" },
      ],
    });
    expect(presentation.details.edits[1]).toMatchObject({
      addedLines: 1,
      removedLines: 1,
    });
    expect(presentation.addedLines).toBe(2);
    expect(presentation.removedLines).toBe(2);
  });

  test("caps generated file content at WorkBuddy's 500-line rendering limit", () => {
    const content = Array.from({ length: 503 }, (_, index) => `line ${index + 1}`).join("\n");
    const presentation = buildTranscriptToolPresentation({
      toolName: "write_file",
      toolInput: { filePath: "/workspace/generated.txt", content },
      toolOutput: { result: { isNewFile: true, addLineCount: 503 } },
    });

    expect(presentation.details?.kind).toBe("write");
    if (presentation.details?.kind !== "write") throw new Error("Expected write details");
    expect(presentation.details.lines).toHaveLength(500);
    expect(presentation.details.omittedCount).toBe(3);
    expect(presentation.details.lines[499]).toEqual({ kind: "added", text: "line 500" });
  });

  test("keeps OpenCode apply-patch bodies visible in the dedicated diff surface", () => {
    const presentation = buildTranscriptToolPresentation({
      toolName: "apply_patch",
      toolInput: {
        patchText: [
          "*** Begin Patch",
          "*** Update File: apps/app/src/app.tsx",
          "@@",
          "-const width = 720;",
          "+const width = 760;",
          " const gap = 16;",
          "*** End Patch",
        ].join("\n"),
      },
      toolOutput: "Done!",
    });

    expect(presentation.details).toMatchObject({
      kind: "write",
      fileName: "app.tsx",
      filePath: "apps/app/src/app.tsx",
      operation: "modify",
      lines: [
        { kind: "removed", text: "const width = 720;" },
        { kind: "added", text: "const width = 760;" },
        { kind: "unchanged", text: "const gap = 16;" },
      ],
    });
  });
});
