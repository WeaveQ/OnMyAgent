import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import enSession from "../src/i18n/locales/en/session";
import zhTWSession from "../src/i18n/locales/zh-TW/session";
import zhSession from "../src/i18n/locales/zh/session";
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
  test("tracks only the latest assistant message as the streaming process owner", () => {
    const historical = assistant("reasoning-complete", [
      { type: "reasoning", text: "先分析任务。" },
      { type: "text", text: "开始执行。" },
    ]);
    const current = assistant("reasoning-current", [
      { type: "reasoning", text: "继续分析最新结果。" },
    ]);
    const streaming: TranscriptTurn = {
      ...completedTurn([historical, current]),
      state: "streaming",
    };

    expect(buildTurnContentPresentation(streaming)?.streamingMessageId).toBe(
      "reasoning-current",
    );
    expect(
      buildTurnContentPresentation(completedTurn([historical, current]))
        ?.streamingMessageId,
    ).toBeNull();
  });

  test("adds safe narration before every uncovered completed tool stage", () => {
    const turn = completedTurn([
      assistant("reasoning-skill", [{
        type: "reasoning",
        text: "PRIVATE: load the browser skill before doing anything else.",
      }]),
      assistant("tool-skill", [{
        type: "dynamic-tool",
        toolName: "skill",
        toolCallId: "skill-1",
        state: "output-available",
        input: { name: "browser-automation" },
        output: "loaded",
      }]),
      assistant("reasoning-open", [{
        type: "reasoning",
        text: "PRIVATE: now open the target URL.",
      }]),
      assistant("tool-open", [{
        type: "dynamic-tool",
        toolName: "onmyagent_browser_node_repl",
        toolCallId: "browser-1",
        state: "output-available",
        input: { code: "await agent.browsers.open('https://secret.example')" },
        output: "ok",
      }]),
      assistant("reasoning-check", [{
        type: "reasoning",
        text: "PRIVATE: inspect the page and click the first item.",
      }]),
      assistant("tool-check", [{
        type: "dynamic-tool",
        toolName: "onmyagent_browser_node_repl",
        toolCallId: "browser-2",
        state: "output-available",
        input: { code: "await page.locator('.secret').click()" },
        output: "clicked",
      }]),
    ]);

    const presentation = buildTurnContentPresentation(turn);
    const segments = presentation?.segments ?? [];

    expect(segments.map((segment) => segment.kind)).toEqual([
      "synthetic-body",
      "process",
      "synthetic-body",
      "process",
      "synthetic-body",
      "process",
    ]);
    expect(
      segments.flatMap((segment) =>
        "messageKey" in segment ? [segment.messageKey] : []
      ),
    ).toEqual([
      "session.progress_narration.skill_start",
      "session.progress_narration.web_continue",
      "session.progress_narration.web_continue",
    ]);
    const syntheticJson = JSON.stringify(
      segments.filter((segment) => segment.kind === "synthetic-body"),
    );
    expect(syntheticJson).not.toContain("PRIVATE");
    expect(syntheticJson).not.toContain("onmyagent_browser_node_repl");
    expect(syntheticJson).not.toContain("secret.example");
    expect(syntheticJson).not.toContain(".secret");
    expect(presentation?.finalText).toBe("");
  });

  test("keeps real body text authoritative and fills only the next uncovered stage", () => {
    const turn = completedTurn([
      assistant("body", [{ type: "text", text: "我先准备浏览器能力，再打开目标页面。" }]),
      assistant("reasoning-skill", [{ type: "reasoning", text: "load it" }]),
      assistant("tool-skill", [{
        type: "dynamic-tool",
        toolName: "skill",
        toolCallId: "skill-1",
        state: "output-available",
        input: { name: "browser-automation" },
        output: "loaded",
      }]),
      assistant("reasoning-open", [{ type: "reasoning", text: "open it" }]),
      assistant("tool-open", [{
        type: "dynamic-tool",
        toolName: "onmyagent_browser_node_repl",
        toolCallId: "browser-1",
        state: "output-available",
        input: { code: "open" },
        output: "ok",
      }]),
    ]);

    const presentation = buildTurnContentPresentation(turn);

    expect(presentation?.segments.map((segment) => segment.kind)).toEqual([
      "body",
      "process",
      "synthetic-body",
      "process",
    ]);
    expect(presentation?.finalText).toBe("我先准备浏览器能力，再打开目标页面。");
  });

  test("adds narration to the latest uncovered streaming tool without creating final text", () => {
    const turn: TranscriptTurn = {
      ...completedTurn([
        assistant("reasoning-live", [{ type: "reasoning", text: "PRIVATE live plan" }]),
        assistant("tool-live", [{
          type: "dynamic-tool",
          toolName: "onmyagent_browser_node_repl",
          toolCallId: "browser-live",
          state: "input-available",
          input: { code: "await page.screenshot()" },
        }]),
      ]),
      state: "streaming",
    };

    const presentation = buildTurnContentPresentation(turn);

    expect(presentation?.segments.map((segment) => segment.kind)).toEqual([
      "synthetic-body",
      "process",
    ]);
    expect(presentation?.finalText).toBe("");
    expect(presentation?.streamingMessageId).toBe("tool-live");
  });

  test("accepts WorkBuddy-style Chart.js HTML only from the widget CDN allowlist", () => {
    const chart = `<div><h2 class="sr-only">趋势图</h2><div style="position:relative;height:360px"><canvas id="chart"></canvas></div><script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"></script><script>new Chart(document.getElementById("chart"), {})</script></div>`;

    expect(isSandboxedHtmlVisual(chart)).toBe(true);
    expect(isSandboxedHtmlVisual(chart.replace("cdnjs.cloudflare.com", "example.com"))).toBe(false);
    expect(isSandboxedHtmlVisual(`<div><script>localStorage.setItem("x", "y")</script></div>`)).toBe(false);
    expect(isSandboxedHtmlVisual(`<html><body>${chart}</body></html>`)).toBe(false);

    const sandbox = buildVisualSandboxDocument(chart);
    expect(sandbox).toContain("default-src 'none'");
    expect(sandbox).toContain("onmyagent:visual-resize");
    expect(sandbox).toContain("--color-background-tertiary");
    expect(sandbox).toContain("--color-border-secondary");
    expect(sandbox).toContain("--border-radius-lg:12px");
    expect(sandbox).toContain(".c-purple");
    expect(sandbox).toContain(".th{font-family:var(--font-sans");
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
    expect(presentation?.turnCollapseEligible).toBe(true);
    expect(presentation?.segments.map((segment) => segment.kind)).toEqual([
      "body",
      "process",
      "body",
    ]);
    expect(
      presentation?.segments
        .filter((segment) => segment.kind === "process")
        .map((segment) =>
          segment.kind === "process" ? segment.items.map((item) => item.messageId) : [],
        ),
    ).toEqual([["tool-1", "progress-2"]]);
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
    expect(presentation?.segments.map((segment) => segment.kind)).toEqual([
      "synthetic-body",
      "widget",
      "body",
    ]);
  });

  test("keeps a tool widget in chronological order while the turn is running", () => {
    const turn = {
      ...completedTurn([
        assistant("intro", [{ type: "text", text: "先说明图表口径。" }]),
        assistant("reasoning", [{ type: "reasoning", text: "PRIVATE chart planning" }]),
        assistant("tool-widget", [{
          type: "dynamic-tool",
          toolName: "show_widget",
          toolCallId: "widget-live",
          state: "input-available",
          input: {
            title: "趋势图",
            widget_code: '<svg viewBox="0 0 680 120"></svg>',
          },
        }]),
        assistant("tail", [{ type: "reasoning", text: "继续核对数据。" }]),
      ]),
      state: "streaming" as const,
    };

    expect(buildTurnContentPresentation(turn)?.segments.map((segment) => segment.kind)).toEqual([
      "body",
      "process",
      "widget",
      "process",
    ]);
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
      "process",
      "body",
    ]);
  });

  test("keeps reasoning narration inside deep-thinking process folds between browser tools", () => {
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
      "synthetic-body",
      "process",
    ]);
    expect(
      presentation?.segments
        .filter((s) => s.kind === "process")
        .map((s) => s.kind === "process" ? s.items[0]?.part.type : null),
    ).toEqual(["dynamic-tool", "reasoning"]);
    expect(
      presentation?.segments
        .filter((s) => s.kind === "body")
        .map((s) => s.kind === "body" ? s.text : null),
    ).toEqual([
      "我来使用内置浏览器打开小红书并完成任务。",
    ]);
    // Reasoning stays folded with its operation while the narration remains outside.
    expect(
      presentation?.segments
        .filter((s) => s.kind === "process")
        .map((s) => (s.kind === "process" ? s.items.length : 0)),
    ).toEqual([1, 3]);
  });

  test("replaces transient fallback when Kimi later streams real narration", () => {
    const initial = {
      ...completedTurn([
        assistant("intro", [{ type: "text", text: "我先准备浏览器能力。" }]),
        assistant("browser-1", [{
          type: "dynamic-tool",
          toolName: "onmyagent_browser_node_repl",
          toolCallId: "browser-1",
          state: "output-available",
          input: { code: "private first operation" },
          output: "ok",
        }]),
        assistant("reasoning-2", [{ type: "reasoning", text: "PRIVATE next operation" }]),
        assistant("browser-2", [{
          type: "dynamic-tool",
          toolName: "onmyagent_browser_node_repl",
          toolCallId: "browser-2",
          state: "input-available",
          input: { code: "private second operation" },
        }]),
      ]),
      state: "streaming" as const,
    };
    const grown = {
      ...completedTurn([
        initial.assistantMessages[0]!,
        initial.assistantMessages[1]!,
        assistant("real-progress", [{
          type: "text",
          text: "第一项能力已经准备好，我继续检查浏览器环境。",
        }]),
        initial.assistantMessages[2]!,
        initial.assistantMessages[3]!,
      ]),
      state: "streaming" as const,
    };

    const initialPresentation = buildTurnContentPresentation(initial);
    const grownPresentation = buildTurnContentPresentation(grown);

    expect(initialPresentation?.segments.map((segment) => segment.kind)).toEqual([
      "body",
      "process",
      "synthetic-body",
      "process",
    ]);
    expect(grownPresentation?.segments.map((segment) => segment.kind)).toEqual([
      "body",
      "process",
      "body",
      "process",
    ]);
    expect(grownPresentation?.segments.some(
      (segment) => segment.kind === "synthetic-body",
    )).toBe(false);
    expect(grownPresentation?.finalText).toBe(
      "第一项能力已经准备好，我继续检查浏览器环境。",
    );
  });

  test("replaces Kimi wrong-language intermediate progress without mutating source parts", () => {
    const originalEnglish = "I will obtain Kweichow Moutai's financial report data and then generate a trend chart for you.";
    const streaming = {
      ...completedTurn([
        assistant("english-progress", [{ type: "text", text: originalEnglish }]),
        assistant("reasoning", [{ type: "reasoning", text: "PRIVATE next operation" }]),
        assistant("browser", [{
          type: "dynamic-tool",
          toolName: "onmyagent_browser_node_repl",
          toolCallId: "browser-1",
          state: "input-available",
          input: { code: "open private report" },
        }]),
      ]),
      state: "streaming" as const,
    };

    const presentation = buildTurnContentPresentation(streaming, { locale: "zh" });

    expect(presentation?.segments.map((segment) => segment.kind)).toEqual([
      "synthetic-body",
      "process",
    ]);
    expect(presentation?.segments[0]).toMatchObject({
      messageKey: "session.progress_narration.web_start",
    });
    expect(presentation?.finalText).toBe("");
    expect(streaming.assistantMessages[0]?.parts[0]).toEqual({
      type: "text",
      text: originalEnglish,
    });
  });

  test("keeps real narration and synthesizes only a missing later stage", () => {
    const streaming = {
      ...completedTurn([
        assistant("intro-zh", [{ type: "text", text: "我先读取项目文件，确认现有实现。" }]),
        assistant("read-1", [{
          type: "dynamic-tool",
          toolName: "read",
          toolCallId: "read-1",
          state: "output-available",
          input: { filePath: "/private/project/secret.ts" },
          output: "private source contents",
        }]),
        assistant("reasoning", [{ type: "reasoning", text: "Need to update the implementation." }]),
        assistant("edit-1", [{
          type: "dynamic-tool",
          toolName: "apply_patch",
          toolCallId: "edit-1",
          state: "input-available",
          input: { patch: "private patch contents" },
        }]),
      ]),
      state: "streaming" as const,
    };

    const presentation = buildTurnContentPresentation(streaming);
    const body = presentation?.segments.find((segment) => segment.kind === "body");
    const synthetic = presentation?.segments.find(
      (segment) => segment.kind === "synthetic-body",
    );

    expect(body?.kind === "body" ? body.text : null).toBe(
      "我先读取项目文件，确认现有实现。",
    );
    expect(body?.kind === "body" ? body.item.messageId : null).toBe("intro-zh");
    expect(synthetic).toMatchObject({
      id: "synthetic-body:edit-1:0",
      messageKey: "session.progress_narration.edit_continue",
    });
    expect(JSON.stringify(synthetic)).not.toContain("secret.ts");
    expect(JSON.stringify(synthetic)).not.toContain("private patch contents");
  });

  test("uses stable synthetic narration IDs as a live operation grows and folds it after completion", () => {
    const messages = [
      assistant("reasoning", [{ type: "reasoning", text: "Need a command." }]),
      assistant("command", [{
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "command-1",
        state: "input-available" as const,
        input: { command: "print-secret-token" },
      }]),
    ];
    const first = buildTurnContentPresentation({
      ...completedTurn(messages),
      state: "streaming",
    });
    const grown = buildTurnContentPresentation({
      ...completedTurn([
        messages[0]!,
        assistant("command", [{
          type: "dynamic-tool",
          toolName: "bash",
          toolCallId: "command-1",
          state: "output-available",
          input: { command: "print-secret-token" },
          output: "secret output",
        }]),
        assistant("final", [{ type: "text", text: "處理完成。" }]),
      ]),
      state: "completed",
    });

    const firstNarration = first?.segments.find((segment) => segment.kind === "synthetic-body");
    const grownNarration = grown?.segments.find((segment) => segment.kind === "synthetic-body");
    expect(firstNarration?.id).toBe("synthetic-body:command:0");
    expect(grownNarration?.id).toBe(firstNarration?.id);
    expect(firstNarration?.kind === "synthetic-body" ? firstNarration.messageKey : "").toBe(
      "session.progress_narration.command_start",
    );
    expect(JSON.stringify(firstNarration)).not.toContain("secret");
    expect(grown?.turnCollapseEligible).toBe(true);
    expect(grown?.collapsedSegments.map((segment) => segment.kind)).toEqual([
      "hidden",
      "anchor",
    ]);
  });

  test("provides every deterministic progress narration in all supported locales", () => {
    const keys = [
      "session.progress_narration.command_start",
      "session.progress_narration.command_continue",
      "session.progress_narration.edit_start",
      "session.progress_narration.edit_continue",
      "session.progress_narration.generic_start",
      "session.progress_narration.generic_continue",
      "session.progress_narration.plan_start",
      "session.progress_narration.plan_continue",
      "session.progress_narration.read_start",
      "session.progress_narration.read_continue",
      "session.progress_narration.search_start",
      "session.progress_narration.search_continue",
      "session.progress_narration.skill_start",
      "session.progress_narration.skill_continue",
      "session.progress_narration.task_start",
      "session.progress_narration.task_continue",
      "session.progress_narration.visual_start",
      "session.progress_narration.visual_continue",
      "session.progress_narration.web_start",
      "session.progress_narration.web_continue",
    ] as const;

    for (const key of keys) {
      expect(enSession[key]).toBeTruthy();
      expect(zhSession[key]).toBeTruthy();
      expect(zhTWSession[key]).toBeTruthy();
    }
    expect(zhSession["session.progress_narration.web_start"]).toContain("内置浏览器");
    expect(zhTWSession["session.progress_narration.command_start"]).toContain("執行");
  });

  test("adds narration between consecutive completed tools", () => {
    const turn = completedTurn([
      assistant("skill", [{
        type: "dynamic-tool",
        toolName: "skill",
        toolCallId: "s1",
        state: "output-available",
        input: { name: "smooth-browser" },
        output: "ok",
      }]),
      assistant("bash", [{
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "c1",
        state: "output-available",
        input: { command: "which smooth" },
        output: "not found",
      }]),
    ]);
    const presentation = buildTurnContentPresentation(turn);
    expect(presentation?.turnCollapseEligible).toBe(false);
    expect(presentation?.segments.map((s) => s.kind)).toEqual([
      "synthetic-body",
      "process",
      "synthetic-body",
      "process",
    ]);
    expect(
      presentation?.segments.flatMap((s) =>
        s.kind === "process"
          ? s.items.flatMap((item) => item.part.type === "dynamic-tool" ? [item.part.toolName] : [])
          : [],
      ),
    ).toEqual(["skill", "bash"]);
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
        turnCollapseEligible: true,
      });
      expect(buildTurnContentPresentation(turn)?.processItems.map((item) => item.messageId)).toEqual([
        "tool",
      ]);
    },
  );

  test("hides non-widget process content after the final collapsed anchor", () => {
    const presentation = buildTurnContentPresentation(completedTurn([
      assistant("longest", [{ type: "text", text: "这是最长的阶段性正文，用作第一个折叠锚点。" }]),
      assistant("final", [{ type: "text", text: "最终答复。" }]),
      assistant("tail", [{ type: "reasoning", text: "不应出现在折叠态尾部。" }]),
    ]));

    expect(presentation?.collapsedSegments.map((segment) => segment.kind)).toEqual([
      "anchor",
      "anchor",
    ]);
  });

  test.each(["[User Cancelled]", "Interrupted by user"])(
    "removes the exact WorkBuddy cancellation sentinel %s",
    (sentinel) => {
      const turn = {
        ...completedTurn([
          assistant("thinking", [{ type: "reasoning", text: "整理已完成的部分。" }]),
          assistant("partial", [{ type: "text", text: `已完成部分工作。\n${sentinel}` }]),
        ]),
        state: "cancelled" as const,
      };
      expect(buildTurnContentPresentation(turn)?.finalText).toBe("已完成部分工作。");

      const directSuffix = {
        ...completedTurn([
          assistant("thinking-direct", [{ type: "reasoning", text: "检查直接后缀。" }]),
          assistant("partial-direct", [{ type: "text", text: `已完成部分工作。${sentinel}` }]),
        ]),
        state: "cancelled" as const,
      };
      expect(buildTurnContentPresentation(directSuffix)?.finalText).toBe("已完成部分工作。");

      const natural = {
        ...completedTurn([
          assistant("thinking-natural", [{ type: "reasoning", text: "保留自然语言。" }]),
          assistant("natural", [{ type: "text", text: `${sentinel} because the user requested a transcript quote.` }]),
        ]),
        state: "cancelled" as const,
      };
      expect(buildTurnContentPresentation(natural)?.finalText).toContain("because");
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
    expect(presentation?.hoistedItems).toEqual([]);
    const finalBody = presentation?.segments.findLast((segment) => segment.kind === "body");
    expect(finalBody?.kind === "body" ? finalBody.item.bodySegments : null).toEqual([
      { kind: "text", text: "结论如下。\n\n" },
      {
        kind: "widget",
        visual: expect.objectContaining({
          kind: "widget",
          title: "趋势图",
          html: "<div>chart</div>",
        }),
      },
    ]);
  });

  test("keeps a fenced widget renderer active for a single assistant body", () => {
    const presentation = buildTurnContentPresentation(completedTurn([
      assistant("only", [{
        type: "text",
        text: "```show_widget\n{\"title\":\"单图\",\"widget_code\":\"<svg></svg>\"}\n```",
      }]),
    ]));

    expect(presentation?.turnCollapseEligible).toBe(false);
    expect(presentation?.segments.map((segment) => segment.kind)).toEqual(["body"]);
    expect(presentation?.hoistedItems).toEqual([]);
  });

  test("replaces an incomplete streaming widget fence with a loading visual", () => {
    const presentation = buildTurnContentPresentation({
      ...completedTurn([
        assistant("streaming-widget", [{
          type: "text",
          text: "三联预览生成中。\n\n```show_widget\n{\"title\":\"当前物流单\",\"widget_code\":\"<style>",
        }]),
      ]),
      state: "streaming",
    });

    expect(presentation?.finalText).toBe("三联预览生成中。");
    expect(presentation?.finalText).not.toContain("show_widget");
    const body = presentation?.segments.find((segment) => segment.kind === "body");
    expect(body?.kind === "body" ? body.item.bodySegments : null).toEqual([
      { kind: "text", text: "三联预览生成中。\n\n" },
      {
        kind: "widget",
        visual: expect.objectContaining({
          html: "",
          status: "running",
          toolName: "show_widget",
        }),
      },
    ]);
  });

  test("does not expose an incomplete widget payload after streaming stops", () => {
    const presentation = buildTurnContentPresentation(completedTurn([
      assistant("broken-widget", [{
        type: "text",
        text: "预览生成失败。\n\n```show_widget\n{\"widget_code\":",
      }]),
    ]));

    expect(presentation?.finalText).toBe("预览生成失败。");
    expect(presentation?.finalText).not.toContain("widget_code");
    const body = presentation?.segments.find((segment) => segment.kind === "body");
    expect(body?.kind === "body" ? body.item.bodySegments : null).toEqual([
      { kind: "text", text: "预览生成失败。\n\n" },
      {
        kind: "widget",
        visual: expect.objectContaining({ status: "failed" }),
      },
    ]);
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
