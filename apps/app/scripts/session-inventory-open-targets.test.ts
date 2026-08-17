import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";

import {
  inventoryListedFilesToOpenTargets,
  isEligibleSessionResultPath,
  mergeOpenTargetsWithInventory,
  sessionDirectoryKey,
  sessionRelativeExpertInventoryPath,
  shouldScanSessionInventoryRoot,
  wasWrittenDuringTurn,
} from "../src/react-app/capabilities/artifacts/session-inventory-open-targets";
import { selectTurnOpenTargets } from "../src/react-app/domains/session/surface/message-list";
import { classifyOpenTarget, isCollectibleArtifactTarget, type OpenTarget } from "../src/react-app/domains/session/artifacts/open-target";

function message(id: string, role: "user" | "assistant", text: string): UIMessage {
  return { id, role, parts: [{ type: "text", text, state: "done" }] };
}

function fileTarget(
  path: string,
  extras: Partial<OpenTarget> = {},
): OpenTarget {
  return {
    id: `file:${path.toLowerCase()}`,
    kind: "file",
    value: path,
    name: path.split("/").pop() ?? path,
    preview: classifyOpenTarget(path, "file"),
    confidence: 88,
    reason: extras.reason ?? "session inventory",
    exists: extras.exists ?? true,
    ...extras,
  };
}

describe("session inventory eligibility", () => {
  it("accepts any result extension and rejects uploads, hidden, and process files", () => {
    expect(isEligibleSessionResultPath("结果/报价.json")).toBe(true);
    expect(
      isEligibleSessionResultPath(
        "/Users/demo/.onmyagent/workspaces/货运客服专家/sid/发货需求.xlsx",
      ),
    ).toBe(true);
    expect(isEligibleSessionResultPath("合同.xml")).toBe(true);
    expect(isEligibleSessionResultPath("【脚本】审核留痕版.docx")).toBe(true);
    expect(isEligibleSessionResultPath(".opencode/tmp/scratch.json")).toBe(false);
    expect(isEligibleSessionResultPath("tmp/helper.py")).toBe(false);
    expect(isEligibleSessionResultPath("onmyagent-session.json")).toBe(false);
    expect(isEligibleSessionResultPath(".env")).toBe(false);
    expect(isEligibleSessionResultPath("1234567890123-0-用户上传.xlsx")).toBe(false);
  });

  it("only scans isolated per-session directories, not workspace roots", () => {
    expect(
      shouldScanSessionInventoryRoot(
        "C:/Users/me/Library/Application Support/OnMyAgent/expert-sessions/ws/assistant/1753456789000",
      ),
    ).toBe(true);
    expect(shouldScanSessionInventoryRoot("C:/Users/me/OnMyAgent/catalog")).toBe(false);
    expect(shouldScanSessionInventoryRoot("C:/Users/me/Desktop/work")).toBe(false);
  });

  it("keeps file mtime on minted inventory targets", () => {
    const minted = inventoryListedFilesToOpenTargets([
      { path: "结果.json", kind: "file", size: 12, mtimeMs: 1_700_000_100_000 },
      { path: ".hidden", kind: "file", mtimeMs: 1_700_000_100_000 },
      { path: "tmp/scratch.py", kind: "file", mtimeMs: 1_700_000_100_000 },
    ]);
    expect(minted).toHaveLength(1);
    expect(minted[0]).toMatchObject({
      value: "结果.json",
      exists: true,
      updatedAt: 1_700_000_100_000,
    });
  });

  it("treats a file as this-turn only when mtime is at or after the turn start", () => {
    const turnStart = 1_700_000_000_000;
    expect(wasWrittenDuringTurn(1_700_000_000_500, turnStart)).toBe(true);
    expect(wasWrittenDuringTurn(turnStart - 60_000, turnStart)).toBe(false);
    expect(wasWrittenDuringTurn(undefined, turnStart)).toBe(false);
    expect(wasWrittenDuringTurn(1_700_000_000_500, null)).toBe(false);
  });

  it("strips expert catalog prefixes down to the session-relative file", () => {
    expect(sessionDirectoryKey("C:/Users/me/.onmyagent/runtime/expert-sessions/ws/kol/1753456789000"))
      .toBe("1753456789000");
    expect(
      sessionRelativeExpertInventoryPath(
        "kol/1753456789000/【视频脚本】审核留痕版.docx",
        "1753456789000",
      ),
    ).toBe("【视频脚本】审核留痕版.docx");
    expect(sessionRelativeExpertInventoryPath("kol/other/out.docx", "1753456789000")).toBeNull();
  });

  it("merges inventory mtimes onto write-tool candidates", () => {
    const write = fileTarget("结果.json", {
      exists: false,
      reason: "write tool metadata",
      confidence: 95,
    });
    const merged = mergeOpenTargetsWithInventory(
      [write],
      inventoryListedFilesToOpenTargets([
        { path: "结果.json", kind: "file", size: 40, mtimeMs: 9 },
      ]),
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      value: "结果.json",
      exists: true,
      updatedAt: 9,
      confidence: 95,
    });
  });
});

describe("selectTurnOpenTargets turn isolation", () => {
  const filename = "【视频脚本-栖光修护精华-晚晚要早睡】审核留痕版.docx";
  const turnStart = 1_700_000_000_000;

  it("shows every this-turn result file regardless of extension", () => {
    const messages = [
      message("msg_user", "user", "请导出"),
      message("msg_final", "assistant", "写好了。"),
    ] satisfies UIMessage[];
    const verified = [
      fileTarget(filename, { updatedAt: turnStart + 1_000 }),
      fileTarget("导出.json", { preview: "external", updatedAt: turnStart + 1_200 }),
    ];

    expect(
      selectTurnOpenTargets(messages, verified, { turnStartedAt: turnStart })
        .map((target) => target.value)
        .sort(),
    ).toEqual([filename, "导出.json"].sort());
  });

  it("does not show a previous turn's file on a later turn", () => {
    const messages = [
      message("msg_user", "user", "继续"),
      message("msg_final", "assistant", `上一轮的 ${filename} 可以参考。`),
    ] satisfies UIMessage[];
    const verified = [
      fileTarget(filename, { updatedAt: turnStart - 60_000 }),
      fileTarget("本轮.json", { preview: "external", updatedAt: turnStart + 500 }),
    ];

    expect(
      selectTurnOpenTargets(messages, verified, { turnStartedAt: turnStart })
        .map((target) => target.value),
    ).toEqual(["本轮.json"]);
  });

  it("does not show user uploads, hidden files, or process helpers as cards", () => {
    const messages = [
      {
        id: "msg_user",
        role: "user" as const,
        parts: [{
          type: "file" as const,
          filename: "素材.xlsx",
          mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          url: "https://example.test/素材.xlsx",
        }],
      },
      message("msg_final", "assistant", "处理完了。"),
    ] satisfies UIMessage[];
    const verified = [
      fileTarget("素材.xlsx", { updatedAt: turnStart + 100 }),
      fileTarget(".env", { updatedAt: turnStart + 100 }),
      fileTarget("tmp/scratch.py", { updatedAt: turnStart + 100 }),
      fileTarget("onmyagent-session.json", { updatedAt: turnStart + 100 }),
      fileTarget("结果.yaml", { preview: "external", updatedAt: turnStart + 100 }),
    ];

    expect(
      selectTurnOpenTargets(messages, verified, { turnStartedAt: turnStart })
        .map((target) => target.value),
    ).toEqual(["结果.yaml"]);
  });
});

describe("isCollectibleArtifactTarget", () => {
  it("collects any existing result file, including unknown extensions", () => {
    const json = fileTarget("导出.json", { preview: "external", exists: true });
    expect(isCollectibleArtifactTarget(json)).toBe(true);
    expect(isCollectibleArtifactTarget({ ...json, exists: false })).toBe(false);
  });
});
