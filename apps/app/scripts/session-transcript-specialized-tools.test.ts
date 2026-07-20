import { describe, expect, test } from "bun:test";

import { buildTranscriptToolPresentation } from "../src/react-app/domains/session/surface/transcript/tool-presentation";

describe("session transcript WorkBuddy specialized tools", () => {
  test("routes specialized details through the shared root transcript row", async () => {
    const [messageList, specializedTools] = await Promise.all([
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/message-list.tsx",
        import.meta.url,
      )).text(),
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/specialized-tool-details.tsx",
        import.meta.url,
      )).text(),
    ]);

    expect(messageList).toContain("SpecializedToolDetails");
    expect(messageList).toContain("details={specializedDetails}");
    expect(specializedTools).toContain('"session.tool_web_search_results"');
    expect(specializedTools).toContain('"session.tool_lint_more"');
  });

  test("normalizes delete tools to a compact filename row", () => {
    const presentation = buildTranscriptToolPresentation({
      toolName: "delete_file",
      toolInput: { target_file: "/workspace/src/unused.ts" },
      toolOutput: { success: true },
    });

    expect(presentation.family).toBe("delete");
    expect(presentation.details).toEqual({
      kind: "delete",
      fileName: "unused.ts",
      filePath: "/workspace/src/unused.ts",
    });
  });

  test("normalizes lint diagnostics and keeps WorkBuddy's first twenty rows", () => {
    const diagnostics = Array.from({ length: 23 }, (_, index) => ({
      message: `Problem ${index + 1}`,
      file: "/workspace/src/app.ts",
      line: index + 2,
      column: 4,
      severity: index === 0 ? "warning" : "error",
    }));
    const presentation = buildTranscriptToolPresentation({
      toolName: "read_lints",
      toolInput: { paths: ["/workspace/src/app.ts"] },
      toolOutput: { diagnostics },
    });

    expect(presentation.family).toBe("lint");
    expect(presentation.details?.kind).toBe("lint");
    if (presentation.details?.kind !== "lint") throw new Error("Expected lint details");
    expect(presentation.details.pathText).toBe("app.ts");
    expect(presentation.details.errorCount).toBe(23);
    expect(presentation.details.issues).toHaveLength(20);
    expect(presentation.details.omittedCount).toBe(3);
    expect(presentation.details.issues[0]?.location).toBe("L2:4");
  });

  test("normalizes nested WorkBuddy web search and fetch payloads", () => {
    const search = buildTranscriptToolPresentation({
      toolName: "web_search",
      toolInput: { query: "WorkBuddy transcript" },
      toolOutput: {
        result: {
          query: "WorkBuddy transcript",
          results: [{
            title: "WorkBuddy",
            url: "https://example.com/workbuddy",
            site: "example.com",
            snippet: "A result excerpt",
          }],
        },
      },
    });
    const fetch = buildTranscriptToolPresentation({
      toolName: "webfetch",
      toolInput: { url: "https://example.com/article" },
      toolOutput: {
        result: {
          title: "Article title",
          favicon: "https://example.com/favicon.ico",
          content: "Article content",
        },
      },
    });
    const plainFetch = buildTranscriptToolPresentation({
      toolName: "webfetch",
      toolInput: { url: "https://example.com/plain" },
      toolOutput: "Fetched page body",
    });

    expect(search.family).toBe("web-search");
    expect(search.details).toEqual({
      kind: "web-search",
      query: "WorkBuddy transcript",
      results: [{
        favicon: null,
        site: "example.com",
        snippet: "A result excerpt",
        title: "WorkBuddy",
        url: "https://example.com/workbuddy",
      }],
    });
    expect(fetch.family).toBe("web-fetch");
    expect(fetch.details).toEqual({
      kind: "web-fetch",
      content: "Article content",
      favicon: "https://example.com/favicon.ico",
      title: "Article title",
      url: "https://example.com/article",
    });
    expect(plainFetch.details).toEqual({
      kind: "web-fetch",
      content: "Fetched page body",
      favicon: null,
      title: null,
      url: "https://example.com/plain",
    });
  });

  test("normalizes OpenCode todo and task results without exposing raw JSON", () => {
    const todo = buildTranscriptToolPresentation({
      toolName: "todowrite",
      toolInput: {
        todos: [
          { content: "Inspect source", status: "completed" },
          { content: "Match renderer", status: "in_progress" },
          { content: "Verify screenshots", status: "pending" },
        ],
      },
      toolOutput: "Todos updated",
    });
    const task = buildTranscriptToolPresentation({
      toolName: "task",
      toolInput: {
        description: "Audit the transcript",
        subagent_type: "explore",
      },
      toolOutput: {
        toolInfo: [{ toolName: "read", executeStatus: "done", info: "message-list.tsx" }],
        finalResult: "Audit complete",
      },
    });

    expect(todo.family).toBe("plan");
    expect(todo.details).toEqual({
      kind: "plan",
      name: null,
      overview: null,
      todos: [
        { activeForm: null, content: "Inspect source", status: "completed" },
        { activeForm: null, content: "Match renderer", status: "in_progress" },
        { activeForm: null, content: "Verify screenshots", status: "pending" },
      ],
    });
    expect(task.family).toBe("task");
    expect(task.details).toEqual({
      kind: "task",
      description: "Audit the transcript",
      finalResult: "Audit complete",
      subagentName: "explore",
      toolItems: [{ name: "read", status: "done", summary: "message-list.tsx" }],
    });
  });

  test("normalizes WorkBuddy visualizer read-me aliases and preserves the semantic result", () => {
    const output = JSON.stringify({
      type: "visualizer_read_me_result",
      content: "# Visualizer Core Design System\n\n# Charts (Chart.js)",
    });

    for (const toolName of [
      "read_me",
      "visualize:read_me",
      "visualizer:read_me",
      "visualizer:read_me_tool",
      "get_design_spec",
    ]) {
      const presentation = buildTranscriptToolPresentation({
        toolName,
        toolInput: { modules: ["chart"] },
        toolOutput: output,
      });

      expect(presentation.family).toBe("generic");
      expect(presentation.details).toEqual({
        kind: "visualizer-read-me",
        result: JSON.stringify(JSON.parse(output), null, 2),
      });
    }
  });

  test("unwraps WorkBuddy MCP-like visualizer read-me results", () => {
    const semanticResult = JSON.stringify({
      type: "visualizer_read_me_result",
      content: "# Visualizer Core Design System",
    });
    const presentation = buildTranscriptToolPresentation({
      toolName: "read_me",
      toolInput: { modules: "[\"diagram\"]" },
      toolOutput: {
        result: {
          data: [{ type: "text", text: semanticResult }],
        },
      },
    });

    expect(presentation.details).toEqual({
      kind: "visualizer-read-me",
      result: expect.stringContaining("visualizer_read_me_result"),
    });
  });

  test("routes visualizer read-me through its dedicated WorkBuddy transcript row", async () => {
    const [messageList, specializedTools] = await Promise.all([
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/message-list.tsx",
        import.meta.url,
      )).text(),
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/specialized-tool-details.tsx",
        import.meta.url,
      )).text(),
    ]);

    expect(messageList).toContain("VisualizerReadMeToolRow");
    expect(specializedTools).toContain('data-tool-details="visualizer-read-me"');
    expect(specializedTools).toContain("max-h-[300px]");
    expect(specializedTools).toContain('t("session.tool_visualizer_read_me")');
    expect(specializedTools).toContain('"session.tool_visualizer_read_me_loaded"');
  });
});
