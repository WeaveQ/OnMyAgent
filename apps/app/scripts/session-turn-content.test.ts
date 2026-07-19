import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import { buildTurnContentPresentation } from "../src/react-app/domains/session/surface/transcript/turn-content";
import {
  buildVisualSandboxDocument,
  isSandboxedHtmlVisual,
} from "../src/react-app/domains/session/surface/transcript/inline-visual";
import type { TranscriptTurn } from "../src/react-app/domains/session/surface/transcript/turn-model";

function assistant(
  id: string,
  parts: UIMessage["parts"],
): UIMessage {
  return { id, role: "assistant", parts };
}

function completedTurn(messages: UIMessage[]): TranscriptTurn {
  return {
    id: "turn-1",
    messages,
    userMessage: null,
    assistantMessages: messages,
    state: "completed",
    startedAt: 1,
    completedAt: 2,
    durationMs: 1,
    actionMessageId: messages.at(-1)?.id ?? null,
  };
}

describe("WorkBuddy turn content presentation", () => {
  test("accepts WorkBuddy-style Chart.js HTML only from the widget CDN allowlist", () => {
    const chart = `<div><h2 class="sr-only">趋势图</h2><div style="position:relative;height:360px"><canvas id="chart"></canvas></div><script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script><script>new Chart(document.getElementById("chart"), {})</script></div>`;

    expect(isSandboxedHtmlVisual(chart)).toBe(true);
    expect(isSandboxedHtmlVisual(chart.replace("cdnjs.cloudflare.com", "example.com"))).toBe(false);
    expect(isSandboxedHtmlVisual(`<div><script>localStorage.setItem("x", "y")</script></div>`)).toBe(false);
    expect(isSandboxedHtmlVisual(`<html><body>${chart}</body></html>`)).toBe(false);

    const sandbox = buildVisualSandboxDocument(chart);
    expect(sandbox).toContain("default-src 'none'");
    expect(sandbox).toContain("onmyagent:visual-resize");
    expect(sandbox).toContain(chart);
  });

  test("keeps only the final body as the anchor and folds prior narration with tools", () => {
    const turn = completedTurn([
      assistant("progress-1", [{ type: "text", text: "数据获取完毕，开始补充历史数据。" }]),
      assistant("tool-1", [{
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "bash-1",
        state: "output-available",
        input: { command: "curl https://example.com | python3 report.py" },
        output: "ok",
      }]),
      assistant("progress-2", [{ type: "reasoning", text: "正在生成趋势图。" }]),
      assistant("final", [{ type: "text", text: "## 财务趋势\n\n2025 年营收小幅回落。" }]),
    ]);

    const presentation = buildTurnContentPresentation(turn);

    expect(presentation?.anchorMessageId).toBe("progress-1");
    expect(presentation?.finalText).toBe("## 财务趋势\n\n2025 年营收小幅回落。");
    expect(presentation?.processItems.map((item) => item.messageId)).toEqual([
      "tool-1",
      "progress-2",
    ]);
    expect(presentation?.hoistedItems).toEqual([]);
    expect(presentation?.segments.map((segment) => segment.kind)).toEqual([
      "body",
      "process",
      "body",
      "body",
    ]);
    expect(
      presentation?.segments
        .filter((segment) => segment.kind === "process")
        .map((segment) =>
          segment.kind === "process" ? segment.items.map((item) => item.messageId) : [],
        ),
    ).toEqual([["tool-1"]]);
    expect(presentation?.collapsedSegments.at(-1)?.kind).toBe("anchor");
  });

  test("hoists WorkBuddy widget tools after the final answer instead of burying them in details", () => {
    const turn = completedTurn([
      assistant("tool-widget", [{
        type: "dynamic-tool",
        toolName: "render_visual",
        toolCallId: "widget-1",
        state: "output-available",
        input: { title: "趋势图", widget_code: "<canvas id=\"chart\"></canvas>" },
        output: { title: "趋势图", widget_code: "<canvas id=\"chart\"></canvas>" },
      }]),
      assistant("final", [{ type: "text", text: "图表如下。" }]),
    ]);

    const presentation = buildTurnContentPresentation(turn);

    expect(presentation?.processItems).toEqual([]);
    expect(presentation?.hoistedItems).toHaveLength(1);
    expect(presentation?.hoistedItems[0]?.kind).toBe("widget");
    expect(presentation?.hoistedItems[0]).toMatchObject({
      status: "completed",
      loadingMessages: [],
      errorText: null,
    });
  });

  test("extracts a widget from a WorkBuddy MCP-like nested result", () => {
    const widgetCode = '<svg viewBox="0 0 680 120"><text x="20" y="30">趋势</text></svg>';
    const turn = completedTurn([
      assistant("tool-widget", [{
        type: "dynamic-tool",
        toolName: "visualize:show_widget",
        toolCallId: "widget-mcp-1",
        state: "output-available",
        input: { title: "初始标题" },
        output: {
          result: {
            data: [{
              type: "text",
              text: JSON.stringify({
                type: "visualizer_show_widget_result",
                title: "现金流趋势",
                widget_code: widgetCode,
                loading_messages: ["完成图表"],
              }),
            }],
          },
        },
      }]),
      assistant("final", [{ type: "text", text: "图表如下。" }]),
    ]);

    expect(buildTurnContentPresentation(turn)?.hoistedItems[0]).toMatchObject({
      title: "现金流趋势",
      html: widgetCode,
      loadingMessages: ["完成图表"],
      status: "completed",
    });
  });

  test("preserves WorkBuddy widget loading messages while the tool is running", () => {
    const turn = {
      ...completedTurn([
        assistant("widget-running", [{
          type: "dynamic-tool",
          toolName: "visualizer:show_widget",
          toolCallId: "widget-running-1",
          state: "input-available",
          input: {
            title: "趋势图",
            loading_messages: ["整理数据", "绘制图表"],
          },
        }]),
      ]),
      state: "streaming" as const,
    };

    expect(buildTurnContentPresentation(turn)?.hoistedItems[0]).toMatchObject({
      status: "running",
      html: "",
      loadingMessages: ["整理数据", "绘制图表"],
      errorText: null,
    });
  });

  test("preserves a partial widget fragment for WorkBuddy streaming preview", () => {
    const partialSvg = '<svg viewBox="0 0 680 120"><rect width="240" height="40" /></svg>';
    const turn = {
      ...completedTurn([
        assistant("widget-streaming", [{
          type: "dynamic-tool",
          toolName: "visualizer:show_widget",
          toolCallId: "widget-streaming-1",
          state: "input-available",
          input: {
            title: "趋势图",
            widget_code: partialSvg,
            loading_messages: ["整理数据", "绘制图表"],
          },
        }]),
      ]),
      state: "streaming" as const,
    };

    expect(buildTurnContentPresentation(turn)?.hoistedItems[0]).toMatchObject({
      status: "running",
      html: partialSvg,
      loadingMessages: ["整理数据", "绘制图表"],
    });
  });

  test("keeps a failed WorkBuddy widget as an explicit visual error state", () => {
    const turn = {
      ...completedTurn([
        assistant("widget-failed", [{
          type: "dynamic-tool",
          toolName: "show_widget",
          toolCallId: "widget-failed-1",
          state: "output-error",
          input: { title: "趋势图", loading_messages: "整理数据, 绘制图表" },
          errorText: "Invalid SVG",
        }]),
      ]),
      state: "failed" as const,
    };

    expect(buildTurnContentPresentation(turn)?.hoistedItems[0]).toMatchObject({
      status: "failed",
      title: "趋势图",
      loadingMessages: ["整理数据", "绘制图表"],
      errorText: "Invalid SVG",
    });
  });

  test("keeps a plain answer untouched and folds streaming process around its latest body", () => {
    const single = completedTurn([
      assistant("final", [{ type: "text", text: "只有最终答复。" }]),
    ]);
    const streaming = {
      ...completedTurn([
        assistant("reasoning", [{ type: "reasoning", text: "分析中" }]),
        assistant("final", [{ type: "text", text: "仍在生成" }]),
      ]),
      state: "streaming" as const,
    };

    expect(buildTurnContentPresentation(single)).toBeNull();
    expect(buildTurnContentPresentation(streaming)).toMatchObject({
      anchorMessageId: "reasoning",
      finalText: "仍在生成",
      state: "streaming",
    });
    expect(buildTurnContentPresentation(streaming)?.processItems.map((item) => item.messageId)).toEqual([
      "reasoning",
    ]);
    expect(buildTurnContentPresentation(streaming)?.segments.map((segment) => segment.kind)).toEqual([
      "body",
      "body",
    ]);
  });

  test("surfaces reasoning narration outside process folds between browser tools", () => {
    const streaming = {
      ...completedTurn([
        assistant("intro", [{ type: "text", text: "我来使用内置浏览器打开小红书并完成任务。" }]),
        assistant("t1", [{
          type: "dynamic-tool",
          toolName: "onmyagent_browser_node_repl",
          toolCallId: "b1",
          state: "output-available",
          input: {},
          output: "ok",
        }]),
        assistant("n1", [{ type: "reasoning", text: "截图返回null可能是因为它已经被显示了。让我看一下页面状态。" }]),
        assistant("t2", [{
          type: "dynamic-tool",
          toolName: "onmyagent_browser_node_repl",
          toolCallId: "b2",
          state: "output-available",
          input: {},
          output: "ok",
        }]),
        assistant("n2", [{ type: "reasoning", text: "页面已加载。现在我需要找到第一个帖子并点击它。" }]),
      ]),
      state: "streaming" as const,
    };
    const presentation = buildTurnContentPresentation(streaming);
    expect(presentation?.segments.map((s) => s.kind)).toEqual([
      "body",
      "process",
      "body",
      "process",
      "body",
    ]);
    expect(
      presentation?.segments
        .filter((s) => s.kind === "process")
        .every((s) => s.kind === "process" && s.items.every((i) => i.part.type === "dynamic-tool")),
    ).toBe(true);
  });

  test.each(["cancelled", "failed"] as const)(
    "folds noisy process for a %s turn instead of leaking transport blocks",
    (state) => {
      const turn = {
        ...completedTurn([
          assistant("progress", [{ type: "text", text: "正在抓取数据。" }]),
          assistant("tool", [{
            type: "dynamic-tool",
            toolName: "bash",
            toolCallId: "bash-1",
            state: "output-available",
            input: { command: "curl https://example.com" },
            output: "ok",
          }]),
          assistant("latest", [{ type: "text", text: "已获得部分数据。" }]),
        ]),
        state,
      };

      expect(buildTurnContentPresentation(turn)).toMatchObject({
        anchorMessageId: "progress",
        finalText: "已获得部分数据。",
        state,
      });
      expect(buildTurnContentPresentation(turn)?.processItems.map((item) => item.messageId)).toEqual([
        "tool",
      ]);
    },
  );

  test("recognizes fenced widgets embedded in final assistant text", () => {
    const turn = completedTurn([
      assistant("reasoning", [{ type: "reasoning", text: "准备图表" }]),
      assistant("final", [{
        type: "text",
        text: "结论如下。\n\n```show_widget\n{\"title\":\"趋势图\",\"widget_code\":\"<div>chart</div>\"}\n```",
      }]),
    ]);

    const presentation = buildTurnContentPresentation(turn);

    expect(presentation?.finalText).toBe("结论如下。");
    expect(presentation?.hoistedItems).toHaveLength(1);
    expect(presentation?.hoistedItems[0]).toMatchObject({
      kind: "widget",
      title: "趋势图",
      html: "<div>chart</div>",
    });
  });

  test("keeps the first assistant anchor and existing segment keys stable across streaming growth", () => {
    const firstMessages = [
      assistant("thinking", [{ type: "reasoning", text: "分析数据" }]),
      assistant("intro", [{ type: "text", text: "先获取基本面数据。" }]),
    ];
    const grownMessages = [
      ...firstMessages,
      assistant("tool", [{
        type: "dynamic-tool",
        toolName: "web_search",
        toolCallId: "web-1",
        state: "output-available",
        input: { query: "贵州茅台财报" },
        output: { results: [] },
      }]),
      assistant("progress", [{ type: "text", text: "数据获取成功，继续生成图表。" }]),
    ];
    const first = buildTurnContentPresentation({
      ...completedTurn(firstMessages),
      state: "streaming",
    });
    const grown = buildTurnContentPresentation({
      ...completedTurn(grownMessages),
      state: "streaming",
    });

    expect(first?.anchorMessageId).toBe("thinking");
    expect(grown?.anchorMessageId).toBe("thinking");
    expect(grown?.segments.slice(0, 2).map((segment) => segment.id)).toEqual(
      first?.segments.map((segment) => segment.id),
    );
  });

  test("isolates todo updates as a stable task-list segment", () => {
    const presentation = buildTurnContentPresentation({
      ...completedTurn([
        assistant("intro", [{ type: "text", text: "开始执行任务。" }]),
        assistant("todo", [{
          type: "dynamic-tool",
          toolName: "todowrite",
          toolCallId: "todo-1",
          state: "input-available",
          input: { todos: [{ content: "生成趋势图", status: "in_progress" }] },
        }]),
      ]),
      state: "streaming",
    });

    expect(presentation?.segments.map((segment) => segment.kind)).toEqual([
      "body",
      "process",
    ]);
    expect(presentation?.segments.at(-1)?.id).toBe("process:todo:0");
  });
});
