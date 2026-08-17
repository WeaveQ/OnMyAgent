import { describe, expect, it } from "bun:test";

import {
  assistantTextIncludesFilename,
  lastAssistantTextFromMessages,
  matchInventoryPathsInText,
  mergeOpenTargetsWithInventory,
  mintInventoryOpenTargets,
  sessionDirectoryKey,
  sessionRelativeExpertInventoryPath,
} from "../src/react-app/capabilities/artifacts/session-inventory-open-targets";
import { selectTurnOpenTargets } from "../src/react-app/domains/session/surface/message-list";
import { classifyOpenTarget, type OpenTarget } from "../src/react-app/domains/session/artifacts/open-target";
import type { UIMessage } from "ai";

function message(id: string, role: "user" | "assistant", text: string): UIMessage {
  return { id, role, parts: [{ type: "text", text, state: "done" }] };
}

function fileTarget(path: string, exists = true): OpenTarget {
  return {
    id: `file:${path.toLowerCase()}`,
    kind: "file",
    value: path,
    name: path.split("/").pop() ?? path,
    preview: classifyOpenTarget(path, "file"),
    confidence: 88,
    reason: "session inventory",
    exists,
  };
}

describe("session inventory matching", () => {
  const filename = "【视频脚本-栖光修护精华-晚晚要早睡】审核留痕版.docx";

  it("matches an inventory file mentioned under any Chinese label", () => {
    const text = `已生成完毕。\n\n完稿：${filename} （当前会话目录下，43816 字节）`;
    expect(matchInventoryPathsInText([filename, "scratch.json"], text)).toEqual([
      filename,
    ]);
  });

  it("does not require backticks or a delivery-keyword list", () => {
    const text = `成品 ${filename}`;
    const minted = mintInventoryOpenTargets([`output/${filename}`], text);
    expect(minted.map((target) => target.value)).toEqual([`output/${filename}`]);
    expect(minted[0]?.reason).toBe("session inventory");
  });

  it("does not match a shorter basename glued inside a longer name", () => {
    expect(assistantTextIncludesFilename("见 final-report.docx", "report.docx")).toBe(
      false,
    );
    expect(assistantTextIncludesFilename("见 report.docx。", "report.docx")).toBe(true);
  });

  it("ignores inventory files the latest assistant text does not name", () => {
    expect(matchInventoryPathsInText([filename], "还在整理素材。")).toEqual([]);
  });

  it("strips expert catalog prefixes down to the session-relative file", () => {
    expect(sessionDirectoryKey("C:/Users/me/.onmyagent/runtime/expert-sessions/ws/kol/ses_abc"))
      .toBe("ses_abc");
    expect(
      sessionRelativeExpertInventoryPath(
        "kol/ses_abc/【视频脚本】审核留痕版.docx",
        "ses_abc",
      ),
    ).toBe("【视频脚本】审核留痕版.docx");
    expect(
      sessionRelativeExpertInventoryPath("kol/ses_abc/合同输出/out.docx", "ses_abc"),
    ).toBe("合同输出/out.docx");
    expect(sessionRelativeExpertInventoryPath("kol/other/out.docx", "ses_abc")).toBeNull();
  });

  it("merges inventory targets without dropping write-tool candidates", () => {
    const write = fileTarget("已写入.xlsx", false);
    write.reason = "write tool metadata";
    write.confidence = 95;
    const merged = mergeOpenTargetsWithInventory(
      [write],
      mintInventoryOpenTargets([filename], `交付：${filename}`),
    );
    expect(merged.map((target) => target.value).sort()).toEqual(
      [filename, "已写入.xlsx"].sort(),
    );
  });
});

describe("selectTurnOpenTargets inventory cards", () => {
  it("shows a card when the last assistant message names a verified session file", () => {
    const filename = "【视频脚本-栖光修护精华-晚晚要早睡】审核留痕版.docx";
    const messages = [
      message("msg_progress", "assistant", "正在读取 素材清单.xlsx。"),
      message("msg_final", "assistant", `完稿：${filename} （当前会话目录下）`),
    ] satisfies UIMessage[];
    const verified = [
      fileTarget("素材清单.xlsx"),
      fileTarget(filename),
    ];

    expect(selectTurnOpenTargets(messages, verified).map((target) => target.value)).toEqual([
      filename,
    ]);
  });

  it("does not mint a card for a verified file that only appeared earlier in the turn", () => {
    const messages = [
      message("msg_progress", "assistant", "正在读取 `用户输入.xlsx`。"),
      message("msg_final", "assistant", "交付物：`最终输出.xlsx`。"),
    ] satisfies UIMessage[];
    const verified = [
      fileTarget("用户输入.xlsx"),
      fileTarget("最终输出.xlsx"),
    ];

    expect(selectTurnOpenTargets(messages, verified).map((target) => target.value)).toEqual([
      "最终输出.xlsx",
    ]);
  });
});

describe("lastAssistantTextFromMessages", () => {
  it("returns only the latest assistant text blob", () => {
    expect(
      lastAssistantTextFromMessages([
        message("a", "assistant", "先看 输入.xlsx"),
        message("b", "user", "继续"),
        message("c", "assistant", "完稿：输出.docx"),
      ]),
    ).toBe("完稿：输出.docx");
  });
});
