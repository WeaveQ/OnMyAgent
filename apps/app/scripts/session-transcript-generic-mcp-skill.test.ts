import { describe, expect, test } from "bun:test";

import { buildTranscriptToolPresentation } from "../src/react-app/domains/session/surface/transcript/tool-presentation";

describe("session transcript WorkBuddy compact generic, MCP, and skill tools", () => {
  test("normalizes WorkBuddy memory and preview-url compact rows", () => {
    const memory = buildTranscriptToolPresentation({
      toolName: "update_memory",
      toolInput: {
        action: "update",
        title: "Preferred output",
        knowledge_to_store: "Use concise summaries",
      },
      toolOutput: { result: { success: true } },
    });
    const preview = buildTranscriptToolPresentation({
      toolName: "preview_url",
      toolInput: { url: "https://example.com/report" },
      toolOutput: { result: { success: true } },
    });

    expect(memory.details).toEqual({
      kind: "compact-tool",
      variant: "memory",
      action: "update",
      title: "Preferred output",
      summary: "Use concise summaries",
      result: '{\n  "success": true\n}',
    });
    expect(preview.details).toEqual({
      kind: "compact-tool",
      variant: "preview-url",
      action: null,
      title: null,
      summary: "https://example.com/report",
      result: '{\n  "success": true\n}',
    });
  });

  test("keeps remaining unknown tools in WorkBuddy's compact result-only row", () => {
    const presentation = buildTranscriptToolPresentation({
      toolName: "custom_workspace_probe",
      toolInput: { internal: "not repeated in compact mode" },
      toolOutput: { result: { status: "ready", count: 3 } },
    });

    expect(presentation.details).toEqual({
      kind: "compact-tool",
      variant: "generic",
      action: null,
      title: null,
      summary: "custom_workspace_probe",
      result: '{\n  "status": "ready",\n  "count": 3\n}',
    });
  });

  test("normalizes MCP call content, progress, and structured resources", () => {
    const presentation = buildTranscriptToolPresentation({
      toolName: "mcp_call_tool",
      toolInput: {
        serverName: "Drive",
        toolName: "search_files",
        arguments: '{"query":"budget"}',
        mcpProgress: { progress: 2, total: 4, message: "Searching" },
      },
      toolOutput: {
        result: {
          data: [
            { type: "text", text: "Found two files" },
            { type: "resource", resource: { uri: "drive://budget", text: "Budget" } },
          ],
        },
      },
    });

    expect(presentation.details).toEqual({
      kind: "mcp",
      serverName: "Drive",
      toolName: "search_files",
      args: { query: "budget" },
      content: [
        { type: "text", text: "Found two files" },
        { type: "resource", text: "Budget" },
      ],
      errorMessage: null,
      progress: { current: 2, total: 4, message: "Searching" },
    });
  });

  test("normalizes fetch-MCP-resource and use-skill rows", () => {
    const resource = buildTranscriptToolPresentation({
      toolName: "fetch_mcp_resource",
      toolInput: { server: "Docs", uri: "https://example.com/guide.md" },
      toolOutput: { result: { content: "# Guide", downloadPath: "/tmp/guide.md" } },
    });
    const skill = buildTranscriptToolPresentation({
      toolName: "use_skill",
      toolInput: { command: "frontend-design" },
      toolOutput: { result: { success: true } },
    });

    expect(resource.details).toEqual({
      kind: "mcp-resource",
      server: "Docs",
      uri: "https://example.com/guide.md",
      content: "# Guide",
      downloadPath: "/tmp/guide.md",
    });
    expect(skill.details).toEqual({ kind: "skill", skillName: "frontend-design" });
  });

  test("routes specialized compact details through the shared transcript renderer", async () => {
    const [source, messageList, fixture] = await Promise.all([
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/specialized-tool-details.tsx",
        import.meta.url,
      )).text(),
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/message-list.tsx",
        import.meta.url,
      )).text(),
      Bun.file(new URL("./session-transcript-visual-fixture.tsx", import.meta.url)).text(),
    ]);

    expect(source).toContain('details.kind === "compact-tool"');
    expect(source).toContain('details.kind === "mcp"');
    expect(source).toContain('details.kind === "mcp-resource"');
    expect(source).toContain('details.kind === "skill"');
    expect(source).toContain('data-tool-details="mcp"');
    expect(source).toContain('details.variant !== "memory"');
    expect(messageList).toContain('specializedDetails.variant === "preview-url"');
    expect(messageList).toContain("platform.openLink(specializedDetails.summary");
    expect(fixture).toContain("compactToolMessages");
    expect(fixture).toContain('toolName: "mcp_call_tool"');
    expect(fixture).toContain('toolName: "use_skill"');
  });
});
