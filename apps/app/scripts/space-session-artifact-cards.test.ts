import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import { classifyOpenTarget, type OpenTarget } from "../src/react-app/domains/session/artifacts/open-target";
import {
  collapseDuplicateFileTargets,
  selectTurnOpenTargets,
} from "../src/react-app/domains/session/surface/message-list/open-targets";

function message(id: string, role: "user" | "assistant", text: string): UIMessage {
  return { id, role, parts: [{ type: "text", text, state: "done" }] };
}

function toolMessage(
  id: string,
  toolName: string,
  input: Record<string, unknown>,
  output: unknown,
): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [{
      type: "dynamic-tool",
      toolName,
      toolCallId: `${id}_tool`,
      state: "output-available",
      input,
      output,
    }],
  };
}

function fileTarget(path: string): OpenTarget {
  return {
    id: `file:${path}`,
    kind: "file",
    value: path,
    name: path.split("/").pop() ?? path,
    preview: classifyOpenTarget(path, "file"),
    confidence: 100,
    reason: "test",
  };
}

describe("space session artifact cards", () => {
  test("collapses relative write path and absolute 文件路径 into one card per file", () => {
    const absPlan = "/Users/me/.onmyagent/spaces/session1/返点毛利计划单.xlsx";
    const absScope = "/Users/me/.onmyagent/spaces/session1/分析口径与阈值.xlsx";
    const messages = [
      toolMessage(
        "msg_plan",
        "write",
        { filePath: "返点毛利计划单.xlsx" },
        { filePath: "返点毛利计划单.xlsx" },
      ),
      toolMessage(
        "msg_scope",
        "write",
        { filePath: "分析口径与阈值.xlsx" },
        { filePath: "分析口径与阈值.xlsx" },
      ),
      message(
        "msg_final",
        "assistant",
        `已拆分为两个独立文件：\n文件路径: ${absPlan}\n文件路径: ${absScope}`,
      ),
    ] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("返点毛利计划单.xlsx"), exists: true, size: 7000 },
      { ...fileTarget(absPlan), exists: true, size: 7000 },
      { ...fileTarget("分析口径与阈值.xlsx"), exists: true, size: 5900 },
      { ...fileTarget(absScope), exists: true, size: 5900 },
    ];
    const cards = selectTurnOpenTargets(messages, verified);
    expect(cards.map((target) => target.name).sort()).toEqual(
      ["分析口径与阈值.xlsx", "返点毛利计划单.xlsx"].sort(),
    );
    expect(cards.map((target) => target.value).sort()).toEqual(
      ["分析口径与阈值.xlsx", "返点毛利计划单.xlsx"].sort(),
    );
  });

  test("keeps two full paths with the same basename in different folders", () => {
    const kept = collapseDuplicateFileTargets([
      {
        ...fileTarget("output/a.xlsx"),
        exists: true,
      },
      {
        ...fileTarget("archive/a.xlsx"),
        exists: true,
      },
    ]);
    expect(kept.map((target) => target.value).sort()).toEqual([
      "archive/a.xlsx",
      "output/a.xlsx",
    ]);
  });
});
