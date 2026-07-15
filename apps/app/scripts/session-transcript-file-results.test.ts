import { describe, expect, test } from "bun:test";

import { buildTranscriptToolPresentation } from "../src/react-app/domains/session/surface/transcript/tool-presentation";

describe("session transcript WorkBuddy file and reference results", () => {
  test("normalizes list results and keeps WorkBuddy's first fifty rows", () => {
    const files = [
      "src/components/",
      ...Array.from({ length: 51 }, (_, index) => ({
        path: `src/components/file-${index + 1}.tsx`,
      })),
    ];
    const presentation = buildTranscriptToolPresentation({
      toolName: "list_dir",
      toolInput: { directory: "src" },
      toolOutput: { result: { path: "src", files } },
    });

    expect(presentation.family).toBe("list");
    expect(presentation.details?.kind).toBe("file-results");
    if (presentation.details?.kind !== "file-results") {
      throw new Error("Expected file results");
    }
    expect(presentation.details.directory).toBe("src");
    expect(presentation.details.items).toHaveLength(50);
    expect(presentation.details.omittedCount).toBe(2);
    expect(presentation.details.items[0]).toEqual({
      path: "src/components/",
      fileName: "components",
      isDirectory: true,
      startLine: null,
      endLine: null,
      content: null,
    });
  });

  test("normalizes search rows with match counts and line ranges", () => {
    const presentation = buildTranscriptToolPresentation({
      toolName: "search_content",
      toolInput: {
        _rawInput: { query: "SessionTranscript", directory: "apps/app/src" },
      },
      toolOutput: {
        result: {
          matches: [
            { filePath: "apps/app/src/message-list.tsx", matches: 7, line: 0, endLine: 0 },
            { file: "apps/app/src/session.ts", startLine: 42, endLine: 45, content: "match" },
          ],
        },
      },
    });

    expect(presentation.family).toBe("search");
    expect(presentation.secondary).toBe("SessionTranscript");
    expect(presentation.details).toEqual({
      kind: "file-results",
      mode: "search",
      query: "SessionTranscript",
      directory: "apps/app/src",
      items: [
        {
          path: "apps/app/src/message-list.tsx",
          fileName: "message-list.tsx",
          isDirectory: false,
          startLine: 0,
          endLine: 0,
          content: "7",
        },
        {
          path: "apps/app/src/session.ts",
          fileName: "session.ts",
          isDirectory: false,
          startLine: 42,
          endLine: 45,
          content: "match",
        },
      ],
      omittedCount: 0,
    });
  });

  test("preserves OpenCode line-oriented grep and glob output", () => {
    const grep = buildTranscriptToolPresentation({
      toolName: "grep",
      toolInput: { pattern: "StepRow" },
      toolOutput: "apps/app/src/message-list.tsx:42:StepRow\napps/app/src/session.ts:7:StepRow",
    });
    const glob = buildTranscriptToolPresentation({
      toolName: "glob",
      toolInput: { pattern: "**/*.tsx" },
      toolOutput: "apps/app/src/app.tsx\napps/app/src/main.tsx",
    });

    expect(grep.details).toMatchObject({
      kind: "file-results",
      items: [
        {
          path: "apps/app/src/message-list.tsx",
          startLine: 42,
          endLine: 42,
          content: "StepRow",
        },
        {
          path: "apps/app/src/session.ts",
          startLine: 7,
          endLine: 7,
          content: "StepRow",
        },
      ],
    });
    expect(glob.details).toMatchObject({
      kind: "file-results",
      items: [
        { path: "apps/app/src/app.tsx" },
        { path: "apps/app/src/main.tsx" },
      ],
    });
  });

  test("normalizes numeric codebase-search references", () => {
    const presentation = buildTranscriptToolPresentation({
      toolName: "codebase_search",
      toolInput: { query: "transcript renderer" },
      toolOutput: {
        result: {
          "0": {
            metadata: {
              file_name: "message-list.tsx",
              source: "apps/app/src/react-app/domains/session/surface/message-list.tsx",
              source_type: "code",
              start_pos: 1454,
              end_pos: 1619,
            },
            chunk: "function StepRow() {}",
          },
          elapsed_ms: 24,
          "1": { metadata: { file_name: "", source: "" } },
        },
      },
    });

    expect(presentation.family).toBe("search");
    expect(presentation.details).toEqual({
      kind: "references",
      referenceType: "codebase",
      query: "transcript renderer",
      references: [{
        fileName: "message-list.tsx",
        source: "apps/app/src/react-app/domains/session/surface/message-list.tsx",
        sourceType: "code",
        startPos: 1454,
        endPos: 1619,
        knowledgeBaseId: null,
        chunk: "function StepRow() {}",
      }],
    });
  });

  test("marks RAG search references as knowledge-base results", () => {
    const presentation = buildTranscriptToolPresentation({
      toolName: "RAG_search",
      toolInput: { query: "design contract" },
      toolOutput: {
        result: {
          "0": {
            metadata: { file_name: "DESIGN.md", source: "https://example.com/DESIGN.md" },
            knowledgeBaseId: "kb-1",
            chunk: "Design rules",
          },
        },
      },
    });

    expect(presentation.details).toMatchObject({
      kind: "references",
      referenceType: "knowledge",
    });
  });

  test("routes both result families through dedicated clickable surfaces", async () => {
    const [detailsSource, messageSource] = await Promise.all([
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/specialized-tool-details.tsx",
        import.meta.url,
      )).text(),
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/message-list.tsx",
        import.meta.url,
      )).text(),
    ]);

    expect(detailsSource).toContain('data-tool-details="file-results"');
    expect(detailsSource).toContain('data-tool-details="references"');
    expect(detailsSource).toContain("onOpenCodePath");
    expect(messageSource).toContain("onOpenCodePath={props.onOpenCodePath}");
  });
});
