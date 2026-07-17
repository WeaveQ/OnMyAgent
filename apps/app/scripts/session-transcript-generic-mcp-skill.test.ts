import { describe, expect, test } from "bun:test";

import { buildTranscriptToolPresentation } from "../src/react-app/domains/session/surface/transcript/tool-presentation";
import { summarizeStepCluster } from "../src/react-app/domains/session/surface/message-list";

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

  test("reads MCP progress from real tool metadata instead of fixture-only input", () => {
    const presentation = buildTranscriptToolPresentation({
      toolName: "mcp_call_tool",
      toolInput: {
        serverName: "Drive",
        toolName: "search_files",
        arguments: '{"query":"budget"}',
      },
      toolOutput: { result: { data: [] } },
      toolMetadata: { mcpProgress: { progress: 3, total: 5, message: "Indexing" } },
    });

    expect(presentation.details).toMatchObject({
      kind: "mcp",
      progress: { current: 3, total: 5, message: "Indexing" },
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
      presentation: "http",
    });
    expect(skill.details).toEqual({ kind: "skill", skillName: "frontend-design" });
  });

  test("classifies MCP resources using WorkBuddy's HTTP, image, download, and text order", () => {
    const cases = [
      { uri: "https://example.com/guide.md", content: "# Guide", downloadPath: null, presentation: "http" },
      { uri: "resource://preview.png", content: "data:image/png;base64,AAAA", downloadPath: null, presentation: "image" },
      { uri: "resource://guide.md", content: "Resource saved to: /tmp/guide.md", downloadPath: "/tmp/guide.md", presentation: "download" },
      { uri: "resource://guide.md", content: "# Guide", downloadPath: null, presentation: "text" },
    ] as const;
    for (const item of cases) {
      const presentation = buildTranscriptToolPresentation({
        toolName: "fetch_mcp_resource",
        toolInput: { server: "Docs", uri: item.uri },
        toolOutput: { result: { content: item.content, downloadPath: item.downloadPath } },
      });
      expect(presentation.details).toMatchObject({ presentation: item.presentation });
    }
  });

  test("routes append, completion, open-result, MCP-match, cloud, and integration registry tools", () => {
    const append = buildTranscriptToolPresentation({
      toolName: "append_to_file",
      toolInput: { path: "/tmp/notes.md", content: "next" },
      toolOutput: { result: { success: true } },
    });
    const completion = buildTranscriptToolPresentation({
      toolName: "finish_task",
      toolInput: { message: "Report ready", success: true },
      toolOutput: { result: { details: "Saved to report.md" } },
    });
    const openResult = buildTranscriptToolPresentation({
      toolName: "open_result_view",
      toolInput: { target_file: "/tmp/report.md", viewType: "preview" },
      toolOutput: { result: { success: true } },
    });
    const match = buildTranscriptToolPresentation({
      toolName: "mcp_get_tool_description",
      toolInput: { toolRequests: '[["Drive","search_files"],["Docs","read_page"]]' },
      toolOutput: { result: { success: true } },
    });
    const integration = buildTranscriptToolPresentation({
      toolName: "search_integration_tool",
      toolInput: { query: "deploy" },
      toolOutput: {
        result: {
          data: [{ integrationId: "tcb", integrationName: "CloudBase", toolName: "deploy" }],
          hint: "One integration found",
        },
      },
    });
    const cloud = buildTranscriptToolPresentation({
      toolName: "connect_cloud_service",
      toolInput: { serviceName: "CloudBase" },
      toolOutput: { result: { success: true } },
    });

    expect(append.family).toBe("write");
    expect(append.details).toMatchObject({
      kind: "write",
      operation: "append",
      fileName: "notes.md",
    });
    expect(completion.details).toEqual({
      kind: "completion",
      message: "Report ready",
      success: true,
      details: "Saved to report.md",
    });
    expect(openResult.details).toEqual({
      kind: "open-result",
      target: "/tmp/report.md",
      viewType: "preview",
    });
    expect(match.details).toEqual({
      kind: "mcp-match",
      requests: [
        { serverName: "Drive", toolName: "search_files" },
        { serverName: "Docs", toolName: "read_page" },
      ],
    });
    expect(cloud.details).toEqual({
      kind: "compact-tool",
      variant: "cloud-service",
      action: null,
      title: null,
      summary: "CloudBase",
      result: null,
    });
    expect(integration.details).toEqual({
      kind: "integration",
      integrationName: "Search Integration Tool",
      actionName: null,
      result: null,
      searchResults: [
        { integrationId: "tcb", integrationName: "CloudBase", toolName: "deploy" },
      ],
      hint: "One integration found",
    });
  });

  test("uses the single tool's concrete object in the meta-fold summary", () => {
    const summary = summarizeStepCluster([{
      id: "group-1",
      mode: "standalone",
      parts: [{
        id: "part-1",
        sessionID: "session-1",
        messageID: "message-1",
        type: "tool",
        callID: "call-1",
        tool: "read",
        state: {
          status: "completed",
          input: { filePath: "/workspace/package.json" },
          output: "{}",
          title: "Read package.json",
          metadata: {},
          time: { start: 1, end: 2 },
        },
      }],
    }]);

    expect(summary.label).toContain("package.json");
  });

  test("uses specialized append and cloud labels in single-tool meta-fold summaries", () => {
    const makeSummary = (tool: string, input: Record<string, unknown>) => summarizeStepCluster([{
      id: `group-${tool}`,
      mode: "standalone",
      parts: [{
        id: `part-${tool}`,
        sessionID: "session-1",
        messageID: "message-1",
        type: "tool",
        callID: `call-${tool}`,
        tool,
        state: {
          status: "completed",
          input,
          output: { result: { success: true } },
          title: tool,
          metadata: {},
          time: { start: 1, end: 2 },
        },
      }],
    }]);

    expect(makeSummary("append_to_file", { path: "/workspace/notes.md", content: "next" }).label)
      .toBe("Appended to notes.md");
    expect(makeSummary("connect_cloud_service", { serviceName: "CloudBase" }).label)
      .toBe("Connected to CloudBase");
  });

  test("routes specialized compact details through the shared transcript renderer", async () => {
    const [source, messageList, sessionSync, fixture] = await Promise.all([
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/specialized-tool-details.tsx",
        import.meta.url,
      )).text(),
      Bun.file(new URL(
        "../src/react-app/domains/session/surface/message-list.tsx",
        import.meta.url,
      )).text(),
      Bun.file(new URL("../src/react-app/domains/session/sync/session-sync.ts", import.meta.url)).text(),
      Bun.file(new URL("./session-transcript-visual-fixture.tsx", import.meta.url)).text(),
    ]);

    expect(source).toContain('details.kind === "compact-tool"');
    expect(source).toContain('details.kind === "mcp"');
    expect(source).toContain('details.kind === "mcp-resource"');
    expect(source).toContain('details.kind === "skill"');
    expect(source).toContain('data-tool-details="mcp"');
    expect(source).toContain('data-mcp-image-preview="true"');
    expect(source).toContain('details.presentation === "http"');
    expect(source).toContain('details.presentation === "image"');
    expect(source).toContain('details.presentation === "download"');
    expect(source).toContain('details.variant !== "memory"');
    expect(messageList).toContain('specializedDetails.variant === "preview-url"');
    expect(messageList).toContain('specializedDetails?.kind === "open-result"');
    expect(messageList).toContain("platform.openLink(specializedDetails.summary");
    expect(messageList).toContain("toolMetadata,");
    expect(sessionSync).toContain("toolStateProviderMetadata(part.state)");
    expect(fixture).toContain("compactToolMessages");
    expect(fixture).toContain('toolName: "mcp_call_tool"');
    expect(fixture).toContain('toolName: "use_skill"');
    expect(fixture).toContain("__sessionTranscriptFixtureRoot");
  });
});
