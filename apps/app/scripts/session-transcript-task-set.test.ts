import { describe, expect, test } from "bun:test";
import type { Part } from "@opencode-ai/sdk/v2/client";
import type { UIMessage } from "ai";

import {
  clusterTurnProcessItems,
  processItemToLegacyPart,
} from "../src/react-app/domains/session/surface/message-list/process-fold";
import {
  clusterStepTimelineParts,
  flattenStepTimelineParts,
} from "../src/react-app/domains/session/surface/message-list/step-cluster";
import {
  taskSetCompletedCount,
  taskSetRowCanExpand,
  toTaskSetRowModels,
} from "../src/react-app/domains/session/surface/message-list/task-set-block";
import type { StepTimelineGroup } from "../src/react-app/domains/session/surface/message-list/types";
import {
  buildTranscriptToolPresentation,
  clusterAdjacentTranscriptTools,
  unwrapTaskResultText,
} from "../src/react-app/domains/session/surface/transcript/tool-presentation";
import {
  buildTurnContentPresentation,
  mergeAdjacentTaskProcessSegments,
} from "../src/react-app/domains/session/surface/transcript/turn-content";
import type { TranscriptTurn } from "../src/react-app/domains/session/surface/transcript/turn-model";

function taskToolInput(description: string, toolName = "task") {
  return {
    toolName,
    toolInput: {
      description,
      subagent_type: "explore",
    },
    toolOutput: {
      finalResult: `${description} done`,
    },
  };
}

function taskPart(
  id: string,
  description: string,
  options?: { tool?: string; status?: string; finalResult?: string | null },
): Part {
  const status = options?.status ?? "completed";
  return {
    id,
    type: "tool",
    sessionID: "session",
    messageID: `message-${id}`,
    callID: `call-${id}`,
    tool: options?.tool ?? "task",
    state: {
      status,
      input: { description, subagent_type: "explore" },
      ...(options?.finalResult === null
        ? {}
        : { output: { finalResult: options?.finalResult ?? `${description} done` } }),
      metadata: {},
      time: { start: 1, end: 2 },
    },
  };
}

function bashPart(id: string): Part {
  return {
    id,
    type: "tool",
    sessionID: "session",
    messageID: `message-${id}`,
    callID: `call-${id}`,
    tool: "bash",
    state: {
      status: "completed",
      input: { command: "git status --short" },
      metadata: {},
      time: { start: 1, end: 2 },
    },
  };
}

function stepGroup(id: string, parts: Part[]): StepTimelineGroup {
  return { id, mode: "exploration", parts };
}

function assistant(id: string, parts: UIMessage["parts"]): UIMessage {
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

function streamingTurn(messages: UIMessage[]): TranscriptTurn {
  return {
    ...completedTurn(messages),
    state: "streaming",
    completedAt: null,
    durationMs: null,
  };
}

function taskToolPart(
  id: string,
  description: string,
  toolName = "task",
  state: "output-available" | "input-available" | "output-error" = "output-available",
): UIMessage["parts"][number] {
  if (state === "output-error") {
    return {
      type: "dynamic-tool",
      toolName,
      toolCallId: `${id}-call`,
      state,
      input: { description, subagent_type: "explore" },
      errorText: `${description} failed`,
    };
  }
  if (state === "input-available") {
    return {
      type: "dynamic-tool",
      toolName,
      toolCallId: `${id}-call`,
      state,
      input: { description, subagent_type: "explore" },
    };
  }
  return {
    type: "dynamic-tool",
    toolName,
    toolCallId: `${id}-call`,
    state,
    input: { description, subagent_type: "explore" },
    output: { finalResult: `${description} done` },
  };
}

function bashToolPart(id: string): UIMessage["parts"][number] {
  return {
    type: "dynamic-tool",
    toolName: "bash",
    toolCallId: `${id}-call`,
    state: "output-available",
    input: { command: "git status --short" },
    output: "ok",
  };
}

function processRows(items: Parameters<typeof processItemToLegacyPart>[0][]) {
  const parts = items.flatMap((item) => {
    const part = processItemToLegacyPart(item);
    return part ? [part] : [];
  });
  const ids = items.map((item) => `${item.messageId}:${item.partIndex}`);
  return toTaskSetRowModels(parts, ids);
}

function processTitles(items: Parameters<typeof processItemToLegacyPart>[0][]) {
  return processRows(items).map((row) => row.title);
}

function liveProcessItems(messages: UIMessage[], turnState: "completed" | "streaming" = "completed") {
  const turn = turnState === "streaming" ? streamingTurn(messages) : completedTurn(messages);
  const presentation = buildTurnContentPresentation(turn);
  const processSegments = presentation?.segments.filter((segment) => segment.kind === "process") ?? [];
  return { presentation, processSegments };
}

describe("session transcript parallel task set", () => {
  test("groups three adjacent task tools into one set titled from description", () => {
    const clusters = clusterAdjacentTranscriptTools([
      taskToolInput("Check HK stocks", "task"),
      taskToolInput("Check US stocks", "subagent"),
      taskToolInput("Check market news", "runagent"),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      kind: "task-set",
      items: [
        { toolName: "task", title: "Check HK stocks" },
        { toolName: "subagent", title: "Check US stocks" },
        { toolName: "runagent", title: "Check market news" },
      ],
    });
  });

  test("keeps a lone task as a single card", () => {
    const clusters = clusterAdjacentTranscriptTools([
      taskToolInput("Audit the transcript"),
    ]);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      kind: "single",
      toolName: "task",
      title: "Audit the transcript",
    });
  });

  test("does not swallow a task next to bash into a false trio", () => {
    const clusters = clusterAdjacentTranscriptTools([
      taskToolInput("Audit the transcript"),
      { toolName: "bash", toolInput: { command: "pnpm task check app" } },
      taskToolInput("Write the report"),
    ]);

    expect(clusters.map((cluster) => cluster.kind)).toEqual([
      "single",
      "single",
      "single",
    ]);
    expect(clusters[0]).toMatchObject({
      kind: "single",
      title: "Audit the transcript",
    });
    expect(clusters[1]).toMatchObject({
      kind: "single",
      toolName: "bash",
    });
    expect(clusters[2]).toMatchObject({
      kind: "single",
      title: "Write the report",
    });
  });

  test("flattens adjacent step groups so parallel tasks still become one set", () => {
    const groups = [
      stepGroup("g1", [taskPart("t1", "Check HK stocks")]),
      stepGroup("g2", [
        taskPart("t2", "Check US stocks", { tool: "subagent" }),
        taskPart("t3", "Check market news", { tool: "runagent" }),
      ]),
    ];
    const clusters = clusterStepTimelineParts(flattenStepTimelineParts(groups));

    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.kind).toBe("task-set");
    if (clusters[0]?.kind !== "task-set") return;
    const rows = toTaskSetRowModels(clusters[0].parts, clusters[0].ids);
    expect(rows.map((row) => row.title)).toEqual([
      "Check HK stocks",
      "Check US stocks",
      "Check market news",
    ]);
    expect(taskSetCompletedCount(rows)).toBe(3);
  });

  test("counts finished task-set rows from the shipped presentation model", () => {
    const groups = [
      stepGroup("g1", [
        taskPart("t1", "Done one"),
        taskPart("t2", "Still running", {
          status: "running",
          finalResult: null,
        }),
      ]),
    ];
    const clusters = clusterStepTimelineParts(flattenStepTimelineParts(groups));
    expect(clusters[0]?.kind).toBe("task-set");
    if (clusters[0]?.kind !== "task-set") return;
    const rows = toTaskSetRowModels(clusters[0].parts, clusters[0].ids);
    expect(taskSetCompletedCount(rows)).toBe(1);
  });

  test("keeps the live steps container on the shipped task-set helpers", async () => {
    const source = await Bun.file(
      new URL(
        "../src/react-app/domains/session/surface/message-list/steps-container.tsx",
        import.meta.url,
      ),
    ).text();
    expect(source).toContain("clusterStepTimelineParts");
    expect(source).toContain("TaskSetBlock");
    expect(source).toContain("toTaskSetRowModels");
  });

  test("groups three live WorkBuddy turn process tasks into one set titled from description", () => {
    const presentation = buildTurnContentPresentation(completedTurn([
      assistant("msg-1", [
        taskToolPart("t1", "Check HK stocks", "task"),
        taskToolPart("t2", "Check US stocks", "subagent"),
        taskToolPart("t3", "Check market news", "runagent"),
      ]),
    ]));

    const processSegments = presentation?.segments.filter((segment) => segment.kind === "process") ?? [];
    expect(processSegments).toHaveLength(1);
    expect(processSegments[0]?.kind).toBe("process");
    if (processSegments[0]?.kind !== "process") return;

    const clusters = clusterTurnProcessItems(processSegments[0].items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.kind).toBe("task-set");
    expect(processTitles(processSegments[0].items)).toEqual([
      "Check HK stocks",
      "Check US stocks",
      "Check market news",
    ]);
  });

  test("keeps a lone live WorkBuddy task as a single process card", () => {
    const presentation = buildTurnContentPresentation(completedTurn([
      assistant("msg-1", [taskToolPart("t1", "Audit the transcript")]),
    ]));
    const processSegments = presentation?.segments.filter((segment) => segment.kind === "process") ?? [];
    expect(processSegments).toHaveLength(1);
    if (processSegments[0]?.kind !== "process") return;
    const clusters = clusterTurnProcessItems(processSegments[0].items);
    expect(clusters.map((cluster) => cluster.kind)).toEqual(["items"]);
    expect(processTitles(processSegments[0].items)).toEqual(["Audit the transcript"]);
  });

  test("does not merge a live WorkBuddy task next to bash into a false trio", () => {
    const presentation = buildTurnContentPresentation(completedTurn([
      assistant("msg-1", [
        taskToolPart("t1", "Audit the transcript"),
        bashToolPart("b1"),
        taskToolPart("t2", "Write the report"),
      ]),
    ]));
    const processSegments = presentation?.segments.filter((segment) => segment.kind === "process") ?? [];
    expect(processSegments).toHaveLength(3);
    expect(
      processSegments.flatMap((segment) =>
        segment.kind === "process" ? clusterTurnProcessItems(segment.items).map((cluster) => cluster.kind) : [],
      ),
    ).toEqual(["items", "items", "items"]);
  });

  test("keeps the live WorkBuddy turn content on the shipped task-set helpers", async () => {
    const source = await Bun.file(
      new URL(
        "../src/react-app/domains/session/surface/message-list/turn-content.tsx",
        import.meta.url,
      ),
    ).text();
    expect(source).toContain("mergeAdjacentTaskProcessSegments");
    expect(source).toContain("clusterTurnProcessItems");
    expect(source).toContain("TaskSetBlock");
    expect(source).toContain("toTaskSetRowModels");
  });

  test("groups three still-running live WorkBuddy tasks across narration into one set", () => {
    const { presentation, processSegments } = liveProcessItems([
      assistant("msg-1", [
        taskToolPart("t1", "Check HK stocks", "task", "input-available"),
        taskToolPart("t2", "Check US stocks", "subagent", "input-available"),
        taskToolPart("t3", "Check market news", "runagent", "input-available"),
      ]),
    ], "streaming");

    expect(processSegments).toHaveLength(1);
    if (processSegments[0]?.kind !== "process") return;
    expect(presentation?.segments.filter((segment) => segment.kind === "synthetic-body")).toHaveLength(1);
    const clusters = clusterTurnProcessItems(processSegments[0].items);
    expect(clusters.map((cluster) => cluster.kind)).toEqual(["task-set"]);
    const rows = processRows(processSegments[0].items);
    expect(rows.map((row) => row.title)).toEqual([
      "Check HK stocks",
      "Check US stocks",
      "Check market news",
    ]);
    expect(rows.every((row) => row.status === "running")).toBe(true);
    expect(taskSetCompletedCount(rows)).toBe(0);
    expect(rows.every((row) => taskSetRowCanExpand(row))).toBe(true);
  });

  test("keeps a mixed completion order as one live task set", () => {
    const { processSegments } = liveProcessItems([
      assistant("msg-1", [
        taskToolPart("t1", "Check HK stocks", "task", "input-available"),
        taskToolPart("t2", "Check US stocks", "subagent", "input-available"),
        taskToolPart("t3", "Check market news", "runagent", "output-available"),
      ]),
    ], "streaming");

    expect(processSegments).toHaveLength(1);
    if (processSegments[0]?.kind !== "process") return;
    const rows = processRows(processSegments[0].items);
    expect(rows.map((row) => row.status)).toEqual(["running", "running", "completed"]);
    expect(taskSetCompletedCount(rows)).toBe(1);
  });

  test("keeps a failed live task expandable inside the set", () => {
    const { processSegments } = liveProcessItems([
      assistant("msg-1", [
        taskToolPart("t1", "Check HK stocks", "task", "output-available"),
        taskToolPart("t2", "Check US stocks", "subagent", "output-error"),
        taskToolPart("t3", "Check market news", "runagent", "input-available"),
      ]),
    ], "streaming");

    expect(processSegments).toHaveLength(1);
    if (processSegments[0]?.kind !== "process") return;
    const rows = processRows(processSegments[0].items);
    expect(rows.map((row) => row.status)).toEqual(["completed", "error", "running"]);
    expect(rows[1]?.error).toBe("Check US stocks failed");
    expect(taskSetRowCanExpand(rows[1]!)).toBe(true);
    expect(taskSetCompletedCount(rows)).toBe(1);
  });

  test("does not merge a running live task next to bash into a false trio", () => {
    const { processSegments } = liveProcessItems([
      assistant("msg-1", [
        taskToolPart("t1", "Audit the transcript", "task", "input-available"),
        bashToolPart("b1"),
        taskToolPart("t2", "Write the report", "task", "input-available"),
      ]),
    ], "streaming");

    expect(processSegments).toHaveLength(3);
    expect(
      processSegments.flatMap((segment) =>
        segment.kind === "process" ? clusterTurnProcessItems(segment.items).map((cluster) => cluster.kind) : [],
      ),
    ).toEqual(["items", "items", "items"]);
  });

  test("drops intervening synthetic-body when merging task-family process segments", () => {
    const items = [
      {
        messageId: "m1",
        partIndex: 0,
        index: 0,
        part: taskToolPart("t1", "Check HK stocks"),
      },
      {
        messageId: "m2",
        partIndex: 0,
        index: 1,
        part: taskToolPart("t2", "Check US stocks", "subagent"),
      },
    ];
    const merged = mergeAdjacentTaskProcessSegments([
      { kind: "synthetic-body", id: "s1" },
      { kind: "process", id: "p1", items: [items[0]!] },
      { kind: "synthetic-body", id: "s2" },
      { kind: "process", id: "p2", items: [items[1]!] },
    ]);
    expect(merged.map((segment) => segment.kind)).toEqual(["synthetic-body", "process"]);
    expect(merged[1]).toMatchObject({ kind: "process", id: "p1" });
    if (merged[1] && "items" in merged[1]) {
      expect(merged[1].items).toHaveLength(2);
    }
  });

  test("unwraps wrapped task_result markup in the shipped task presentation", () => {
    const wrapped = [
      '<task id="ses_ffbd3a77bffeYtK06eLKkSBbtv" state="completed">',
      "<task_result>",
      "# Mac system report",
      "Chip: Apple M5",
      "</task_result>",
      "</task>",
    ].join("\n");
    const body = unwrapTaskResultText(wrapped);
    expect(body).toContain("# Mac system report");
    expect(body).toContain("Chip: Apple M5");
    expect(body.includes("<task")).toBe(false);
    expect(body.includes("task_result")).toBe(false);

    const presentation = buildTranscriptToolPresentation({
      toolName: "task",
      toolInput: { description: "系统硬件概况检查", subagent_type: "general" },
      toolOutput: wrapped,
    });
    expect(presentation.details).toMatchObject({
      kind: "task",
      description: "系统硬件概况检查",
      finalResult: body,
    });
  });

  test("collapses a same-description error then retry into one completed row", () => {
    const clusters = clusterAdjacentTranscriptTools([
      {
        toolName: "task",
        toolInput: { description: "分析技能冗余与触发词冲突", subagent_type: "general" },
        toolStatus: "error",
        toolError: "cancelled",
      },
      {
        toolName: "task",
        toolInput: { description: "分析技能冗余与触发词冲突", subagent_type: "general" },
        toolOutput: { finalResult: "Redundancy report" },
        toolStatus: "completed",
      },
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toMatchObject({
      kind: "single",
      title: "分析技能冗余与触发词冲突",
    });
    if (clusters[0]?.kind !== "single") return;
    expect(clusters[0].presentation.details).toMatchObject({
      kind: "task",
      finalResult: "Redundancy report",
    });
  });

  test("keeps distinct descriptions as separate rows in one set", () => {
    const clusters = clusterAdjacentTranscriptTools([
      taskToolInput("扫描所有技能目录与软链"),
      taskToolInput("校验 SKILL.md 元数据"),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.kind).toBe("task-set");
    if (clusters[0]?.kind !== "task-set") return;
    expect(clusters[0].items.map((item) => item.title)).toEqual([
      "扫描所有技能目录与软链",
      "校验 SKILL.md 元数据",
    ]);
  });

  test("collapses a live same-description retry onto the failed row", () => {
    const { processSegments } = liveProcessItems([
      assistant("msg-1", [
        taskToolPart("t1", "扫描所有技能目录与软链"),
        taskToolPart("t2", "分析技能冗余与触发词冲突", "task", "output-error"),
        taskToolPart("t3", "分析技能冗余与触发词冲突"),
      ]),
    ]);
    expect(processSegments).toHaveLength(1);
    if (processSegments[0]?.kind !== "process") return;
    expect(processSegments[0].items).toHaveLength(2);
    const clusters = clusterTurnProcessItems(processSegments[0].items);
    expect(clusters.map((cluster) => cluster.kind)).toEqual(["task-set"]);
    const rows = processRows(processSegments[0].items);
    expect(rows.map((row) => row.title)).toEqual([
      "扫描所有技能目录与软链",
      "分析技能冗余与触发词冲突",
    ]);
    expect(rows[1]?.status).toBe("completed");
    expect(rows[1]?.error).toBeUndefined();
    expect(taskSetCompletedCount(rows)).toBe(2);
  });
});
