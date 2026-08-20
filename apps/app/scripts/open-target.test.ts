import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";

import {
  canPreviewOpenTargetInline,
  classifyOpenTarget,
  collectRuntimeRegisteredDeliverablePaths,
  deriveOpenTargets,
  extractAssistantDeliveryManifestPaths,
  isCollectibleArtifactTarget,
  isUserFacingLocalPreviewTarget,
  resolveArtifactAbsolutePath,
  resolveArtifactRevealCandidates,
  selectAutoOpenTarget,
  shouldAutoOpenTarget,
  type OpenTarget,
} from "../src/react-app/domains/session/artifacts/open-target";
import { selectTurnOpenTargets } from "../src/react-app/domains/session/surface/message-list/open-targets";
import {
  buildWorkspaceFileTree,
  filterHiddenFromTree,
  shouldHideEntry,
} from "../src/react-app/capabilities/artifacts/workspace-file-tree";
import { workspaceFileOpenTarget } from "../src/react-app/capabilities/artifacts/workspace-file-open-target";

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

function fileTarget(path: string, preview?: OpenTarget["preview"]): OpenTarget {
  return {
    id: `file:${path}`,
    kind: "file",
    value: path,
    name: path.split("/").pop() ?? path,
    preview: preview ?? classifyOpenTarget(path, "file"),
    confidence: 100,
    reason: "test",
  };
}

describe("open target classification", () => {
  it("routes common artifact formats to deterministic previews", () => {
    expect(classifyOpenTarget("report.md", "file")).toBe("markdown");
    expect(classifyOpenTarget("customers.csv", "file")).toBe("sheet");
    expect(classifyOpenTarget("forecast.xlsx", "file")).toBe("sheet");
    expect(classifyOpenTarget("contract.docx", "file")).toBe("document");
    expect(classifyOpenTarget("briefing.pptx", "file")).toBe("presentation");
    expect(classifyOpenTarget("manual.pdf", "file")).toBe("pdf");
    expect(classifyOpenTarget("meeting.mp3", "file")).toBe("audio");
    expect(classifyOpenTarget("demo.mp4", "file")).toBe("video");
    expect(classifyOpenTarget("invoice.ofd", "file")).toBe("pdf");
    expect(classifyOpenTarget("diagram.svg", "file")).toBe("image");
    expect(classifyOpenTarget("dist/index.html", "file")).toBe("html");
    expect(classifyOpenTarget("http://localhost:5173", "url")).toBe("browser");
  });
});

describe("canPreviewOpenTargetInline (shared workspace preview policy)", () => {
  it("allows text, markdown, html, images, browser targets, and tabular csv/tsv previews", () => {
    expect(canPreviewOpenTargetInline(fileTarget("notes.md"))).toBe(true);
    expect(canPreviewOpenTargetInline(fileTarget("app.ts"))).toBe(true);
    expect(canPreviewOpenTargetInline(fileTarget("data.json"))).toBe(true);
    expect(canPreviewOpenTargetInline(fileTarget("script.py"))).toBe(true);
    expect(canPreviewOpenTargetInline(fileTarget("page.html"))).toBe(true);
    expect(canPreviewOpenTargetInline(fileTarget("photo.png"))).toBe(true);
    expect(canPreviewOpenTargetInline(fileTarget("meeting.mp3"))).toBe(true);
    expect(canPreviewOpenTargetInline(fileTarget("demo.mp4"))).toBe(true);
    expect(canPreviewOpenTargetInline(fileTarget("data.csv"))).toBe(true);
    expect(canPreviewOpenTargetInline(fileTarget("rows.tsv"))).toBe(true);
    expect(
      canPreviewOpenTargetInline({
        ...fileTarget("https://example.com", "browser"),
        kind: "url",
        value: "https://example.com",
      }),
    ).toBe(true);
  });

  it("previews Office and PDF files without treating unrelated binaries as documents", () => {
    for (const path of [
      "doc.doc",
      "doc.docx",
      "doc.docm",
      "doc.dotx",
      "doc.rtf",
      "doc.odt",
      "ledger.xls",
      "ledger.xlsx",
      "ledger.xlsm",
      "ledger.xlsb",
      "ledger.ods",
      "deck.ppt",
      "deck.pptx",
      "deck.pptm",
      "deck.ppsx",
      "deck.potx",
      "deck.odp",
      "manual.pdf",
      "invoice.ofd",
    ]) {
      expect(canPreviewOpenTargetInline(fileTarget(path))).toBe(true);
    }
    expect(canPreviewOpenTargetInline(fileTarget("archive.zip"))).toBe(false);
    expect(canPreviewOpenTargetInline(fileTarget("program.exe"))).toBe(false);
  });
});

describe("workspace file preview targets", () => {
  it("keeps local HTML in the My Files preview surface", () => {
    const target = workspaceFileOpenTarget({
      fileRoot: "/workspace",
      path: "site/index.html",
      name: "index.html",
      size: 128,
      mtimeMs: 42,
    });

    expect(target.kind).toBe("file");
    expect(target.preview).toBe("html");
    expect(target.value).toBe("site/index.html");
  });
});

describe("canonical workspace file tree helpers", () => {
  it("builds trees and filters hidden paths through the shared module", () => {
    expect(shouldHideEntry(".env")).toBe(true);
    expect(shouldHideEntry("src/main.ts")).toBe(false);

    const tree = buildWorkspaceFileTree([
      { path: "src/main.ts", kind: "file", size: 10, mtimeMs: 1, revision: "" },
      { path: ".git/config", kind: "file", size: 1, mtimeMs: 1, revision: "" },
      { path: "opencode.jsonc", kind: "file", size: 1, mtimeMs: 1, revision: "" },
      { path: "docs/readme.md", kind: "file", size: 20, mtimeMs: 1, revision: "" },
    ]);
    const visible = filterHiddenFromTree(tree);
    const names = visible.children.map((c) => c.name).sort();
    expect(names).toEqual(["docs", "src"]);
    expect(visible.children.find((c) => c.name === ".git")).toBeUndefined();
  });
});

describe("deriveOpenTargets", () => {
  it("collects verified artifacts across one request for the final assistant slot", () => {
    const messages = [
      toolMessage(
        "msg_tool",
        "write",
        { filePath: "reports/final.md" },
        { filePath: "reports/final.md" },
      ),
      message(
        "msg_final",
        "assistant",
        "Created the report and started http://localhost:4173 for preview.",
      ),
    ] satisfies UIMessage[];
    const candidates = deriveOpenTargets(messages);
    const verified = candidates.map((target) =>
      target.kind === "file" ? { ...target, exists: true } : target,
    );

    expect(selectTurnOpenTargets(messages, verified).map((target) => target.value)).toEqual([
      "reports/final.md",
      "http://localhost:4173",
    ]);
  });

  it("hides internal 127.0.0.1 bridge URLs from the turn openable strip", () => {
    const messages = [
      message(
        "msg_1",
        "assistant",
        "已在内置浏览器打开 https://juejin.cn/ 。内部地址 http://127.0.0.1:9823 不应展示。",
      ),
    ] satisfies UIMessage[];
    const candidates = deriveOpenTargets(messages);
    expect(candidates.some((t) => t.value.includes("127.0.0.1"))).toBe(true);
    expect(
      selectTurnOpenTargets(messages, candidates).map((target) => target.value),
    ).not.toContain("http://127.0.0.1:9823");
    expect(
      isUserFacingLocalPreviewTarget({
        id: "url:http://127.0.0.1:9823",
        kind: "url",
        value: "http://127.0.0.1:9823",
        name: "127.0.0.1:9823",
        preview: "browser",
        confidence: 65,
        reason: "message",
      }),
    ).toBe(false);
    expect(
      isUserFacingLocalPreviewTarget({
        id: "url:http://localhost:5173",
        kind: "url",
        value: "http://localhost:5173",
        name: "localhost:5173",
        preview: "browser",
        confidence: 65,
        reason: "message",
      }),
    ).toBe(true);
  });

  it("extracts file and localhost URL targets from recent assistant output", () => {
    const targets = deriveOpenTargets([
      toolMessage("msg_tool", "write", { filePath: "reports/revenue.xlsx" }, { filePath: "reports/revenue.xlsx" }),
      message("msg_1", "assistant", "Created reports/revenue.xlsx and started http://localhost:5173 for preview."),
    ]);

    expect(targets.map((target) => target.value)).toContain("reports/revenue.xlsx");
    expect(targets.map((target) => target.value)).toContain("http://localhost:5173");
    expect(targets.find((target) => target.value === "reports/revenue.xlsx")?.preview).toBe("sheet");
  });

  it("extracts websocket URLs so local socket/dev-server hints stay visible", () => {
    const targets = deriveOpenTargets([
      toolMessage("msg_tool", "write", { filePath: "dist/index.html" }, { filePath: "dist/index.html" }),
      message("msg_1", "assistant", "Socket open at ws://localhost:5173/socket and preview at dist/index.html"),
    ]);

    expect(targets.map((target) => target.value)).toContain("ws://localhost:5173/socket");
    expect(targets.map((target) => target.value)).toContain("dist/index.html");
  });

  it("normalizes Workspace/<id>/ prefixes from artifact paths", () => {
    const targets = deriveOpenTargets([
      toolMessage("msg_tool_1", "write", { filePath: "Workspace/32423/reports/artifact-eval.md" }, { filePath: "Workspace/32423/reports/artifact-eval.md" }),
      toolMessage("msg_tool_2", "write", { filePath: "Workspace/32423/reports/artifact-eval.csv" }, { filePath: "Workspace/32423/reports/artifact-eval.csv" }),
      message("msg_1", "assistant", "See Workspace/32423/reports/artifact-eval.md and Workspace/32423/reports/artifact-eval.csv"),
    ]);

    expect(targets.map((target) => target.value)).toContain("reports/artifact-eval.md");
    expect(targets.map((target) => target.value)).toContain("reports/artifact-eval.csv");
  });

  it("prefers explicit dynamic tool metadata over prose guesses", () => {
    const targets = deriveOpenTargets([
      toolMessage("msg_tool", "write", { path: "summary.md" }, { path: "summary.md" }),
    ]);

    expect(targets[0]).toMatchObject({ value: "summary.md", preview: "markdown", confidence: 95 });
  });

  it("keeps the higher-confidence write target when prose mentions the same path", () => {
    const targets = deriveOpenTargets([
      message("msg_1", "assistant", "Drafted reports/summary.md for review."),
      toolMessage("msg_tool", "write", { filePath: "reports/summary.md" }, { filePath: "reports/summary.md" }),
    ]);

    expect(targets.filter((target) => target.value === "reports/summary.md")).toHaveLength(1);
    expect(targets.find((target) => target.value === "reports/summary.md")).toMatchObject({
      confidence: 95,
      reason: "write tool metadata",
    });
  });

  it("extracts filePath metadata from write tools", () => {
    const targets = deriveOpenTargets([
      toolMessage("msg_tool", "write", { filePath: "reports/summary.md" }, { filePath: "reports/summary.md" }),
    ]);

    expect(targets[0]).toMatchObject({ value: "reports/summary.md", preview: "markdown", confidence: 95 });
  });

  it("does not extract file artifacts from read tool metadata or output", () => {
    const targets = deriveOpenTargets([
      toolMessage(
        "msg_tool",
        "read",
        { filePath: "reports/source.md" },
        { content: "Reviewed reports/source.md and referenced reports/source.csv" },
      ),
      message("msg_2", "assistant", "Reviewed reports/source.md and reports/source.csv."),
    ]);

    expect(targets.map((target) => target.value)).not.toContain("reports/source.md");
    expect(targets.map((target) => target.value)).not.toContain("reports/source.csv");
  });

  it("extracts paths written by apply_patch metadata", () => {
    const targets = deriveOpenTargets([
      toolMessage("msg_tool", "apply_patch", {
        patchText: "*** Begin Patch\n*** Add File: reports/new-report.md\n+hello\n*** Update File: reports/existing-report.csv\n@@\n-old\n+new\n*** End Patch",
      }, "Success. Updated files."),
    ]);

    expect(targets.map((target) => target.value)).toContain("reports/new-report.md");
    expect(targets.map((target) => target.value)).toContain("reports/existing-report.csv");
  });

  it("does not turn package search results into artifacts", () => {
    const targets = deriveOpenTargets([
      toolMessage("msg_tool", "glob", { pattern: "**/package.json" }, {
        files: [
          "package.json",
          "apps/app/package.json",
          "packages/ui/package.json",
          "reports/revenue.csv",
        ],
      }),
      message("msg_2", "assistant", "Found package.json, apps/app/package.json, and reports/revenue.csv"),
    ]);

    expect(targets.map((target) => target.value)).not.toContain("package.json");
    expect(targets.map((target) => target.value)).not.toContain("apps/app/package.json");
    expect(targets.map((target) => target.value)).not.toContain("packages/ui/package.json");
    expect(targets.map((target) => target.value)).not.toContain("reports/revenue.csv");
  });

  it("does not turn discovery tool markdown listings into artifacts", () => {
    const targets = deriveOpenTargets([
      toolMessage("msg_write", "write", { filePath: "reports/created-report.md" }, { filePath: "reports/created-report.md" }),
      toolMessage("msg_tool", "glob", { pattern: "**/*.md" }, {
        files: [
          "README.md",
          ".opencode/skills/example/SKILL.md",
          "reports/created-report.md",
        ],
      }),
      message("msg_2", "assistant", "Created reports/created-report.md as the deliverable."),
    ]);

    expect(targets.map((target) => target.value)).toContain("reports/created-report.md");
    expect(targets.map((target) => target.value)).not.toContain("README.md");
    expect(targets.map((target) => target.value)).not.toContain(".opencode/skills/example/SKILL.md");
  });

  it("does not collect server-verified missing file targets", () => {
    const target = deriveOpenTargets([
      toolMessage("msg_tool", "write", { filePath: "index.html" }, { filePath: "index.html" }),
      message("msg_1", "assistant", "Preview file: index.html"),
    ])[0];

    expect(target).toMatchObject({ value: "index.html", preview: "html" });
    expect(isCollectibleArtifactTarget({ ...target, exists: false })).toBe(false);
    expect(isCollectibleArtifactTarget({ ...target, exists: true })).toBe(true);
  });

  it("does not mint a file card before the candidate is verified to exist", () => {
    const messages = [
      toolMessage(
        "msg_tool",
        "write",
        { filePath: "output/pending.xlsx" },
        { filePath: "output/pending.xlsx" },
      ),
      message("msg_final", "assistant", "The workbook is ready."),
    ] satisfies UIMessage[];

    expect(selectTurnOpenTargets(messages, [])).toEqual([]);
  });

  it("shows verified text files as generated artifacts", () => {
    const messages = [
      toolMessage(
        "msg_tool",
        "write",
        { filePath: "reports/customer-message.txt" },
        { filePath: "reports/customer-message.txt" },
      ),
      message(
        "msg_final",
        "assistant",
        "Created reports/customer-message.txt.",
      ),
    ] satisfies UIMessage[];
    const verified = deriveOpenTargets(messages).map((target) => ({
      ...target,
      exists: true,
    }));

    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.value),
    ).toEqual(["reports/customer-message.txt"]);
  });

  it("shows a verified user-facing file explicitly claimed as generated", () => {
    const messages = [
      message(
        "msg_final",
        "assistant",
        "已生成 发货需求与报价补充.xlsx。",
      ),
    ] satisfies UIMessage[];
    const verified = [{
      ...fileTarget(
        "/Users/demo/work/货运客服专家/1785423406407/发货需求与报价补充.xlsx",
      ),
      exists: true,
      size: 7_884,
    }];

    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.value),
    ).toEqual([
      "/Users/demo/work/货运客服专家/1785423406407/发货需求与报价补充.xlsx",
    ]);
  });

  it("shows a verified file linked with the explicit artifact scheme", () => {
    const messages = [
      message(
        "msg_final",
        "assistant",
        "已完成，[查看对账表](artifact:output/运单对账表.xlsx)。",
      ),
    ] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("/workspace/output/运单对账表.xlsx", "sheet"), exists: true },
    ];

    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.value),
    ).toEqual(["/workspace/output/运单对账表.xlsx"]);
  });

  it("shows verified prose deliverables after Chinese or ASCII colons", () => {
    const messages = [
      message(
        "msg_final",
        "assistant",
        "已生成：report.xlsx\n输出文件: summary.pdf",
      ),
    ] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("report.xlsx", "sheet"), exists: true },
      { ...fileTarget("summary.pdf", "pdf"), exists: true },
    ];

    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.value).sort(),
    ).toEqual(["report.xlsx", "summary.pdf"]);
  });

  it("matches percent-encoded artifact links to verified Unicode paths", () => {
    const messages = [
      message(
        "msg_final",
        "assistant",
        "[查看对账表](artifact:output/%E8%BF%90%E5%8D%95%E5%AF%B9%E8%B4%A6%E8%A1%A8.xlsx)",
      ),
    ] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("output/运单对账表.xlsx", "sheet"), exists: true },
    ];

    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.value),
    ).toEqual(["output/运单对账表.xlsx"]);
  });

  it("prefers the current turn path over an earlier same-named verified file", () => {
    const messages = [
      toolMessage(
        "msg_write",
        "write",
        { filePath: "new/output/report.xlsx" },
        { filePath: "new/output/report.xlsx" },
      ),
      message("msg_final", "assistant", "已生成 new/output/report.xlsx"),
    ] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("old/output/report.xlsx", "sheet"), exists: true },
      { ...fileTarget("new/output/report.xlsx", "sheet"), exists: true },
    ];

    expect(selectTurnOpenTargets(messages, verified).map((target) => target.value)).toEqual([
      "new/output/report.xlsx",
    ]);
  });

  it("does not mint a basename-only claim when verified files are ambiguous", () => {
    const messages = [
      message("msg_final", "assistant", "已生成 report.xlsx"),
    ] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("old/output/report.xlsx", "sheet"), exists: true },
      { ...fileTarget("new/output/report.xlsx", "sheet"), exists: true },
    ];

    expect(selectTurnOpenTargets(messages, verified)).toEqual([]);
  });

  it("keeps an attached user file out when selecting the complete current turn", () => {
    const messages = [
      {
        id: "msg_user",
        role: "user",
        parts: [{
          type: "file",
          filename: "source.xlsx",
          mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          url: "https://example.test/source.xlsx",
        }],
      },
      message("msg_final", "assistant", "已生成 source.xlsx"),
    ] satisfies UIMessage[];
    const verified = [{ ...fileTarget("output/source.xlsx", "sheet"), exists: true }];

    expect(selectTurnOpenTargets(messages, verified)).toEqual([]);
  });

  it("does not treat a user-pasted localhost URL as an assistant preview", () => {
    const messages = [
      message("msg_user", "user", "Please inspect http://localhost:5173"),
      message("msg_final", "assistant", "I will inspect the supplied preview."),
    ] satisfies UIMessage[];

    expect(selectTurnOpenTargets(messages, [])).toEqual([]);
  });

  it("shows every verified deliverable from the turn instead of truncating after four", () => {
    const paths = [
      "output/01.xlsx",
      "output/02.docx",
      "output/03.pdf",
      "output/04.png",
      "output/05.md",
    ];
    const messages = [
      ...paths.map((path, index) => toolMessage(
        `msg_tool_${index}`,
        "write",
        { filePath: path },
        { filePath: path },
      )),
      message("msg_final", "assistant", "五个产物都已生成。"),
    ] satisfies UIMessage[];
    const verified = paths.map((path) => ({ ...fileTarget(path), exists: true }));

    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.value),
    ).toEqual(paths);
  });

  it("shows every verified file from a batch delivery Markdown table", () => {
    const finalText = `全部完成。交付如下：

## 📦 交付物（6 份合同 + 台账）

**合同（\`合同输出/\`）**
| 序号 | 文件 |
|---|---|
| 1 | \`【安姐聊时尚-lan10月-e签宝-斯路】.docx\` |
| 2 | \`【毒舌小扒菜／单口bot-lan10月-e签宝-新偶】.docx\` |
| 3 | \`【我只吃7分饱-lan10月-e签宝-元禾】.docx\` |
| 4 | \`【倦梨逃了-lan10月-e签宝-橘崽】.docx\` |
| 5 | \`【挖哒西挖课代表-lan10月-e签宝-松茸有】.docx\` |
| 6 | \`【小樱日常(可爱版／牛奶方糖粥-lan11月-e签宝-三庚】.docx\` |

**台账**：\`【ai】对公返点信息_已填写完成日期.xlsx\`

以上均为 \`ONMYAGENT_DELIVERABLE\`。`;
    const listedPaths = extractAssistantDeliveryManifestPaths(finalText);
    const contractPaths = listedPaths
      .filter((path) => path.endsWith(".docx"))
      .map((path) => `/workspace/${path}`);
    const ledgerPath = "/workspace/【ai】对公返点信息_已填写完成日期.xlsx";
    const messages = [message("msg_final", "assistant", finalText)] satisfies UIMessage[];
    const verified = [
      ...contractPaths.map((path) => ({ ...fileTarget(path), exists: true })),
      { ...fileTarget(ledgerPath, "sheet"), exists: true },
    ];

    expect(listedPaths).toHaveLength(7);
    expect(deriveOpenTargets(messages).map((target) => target.value)).toEqual(listedPaths);
    expect(selectTurnOpenTargets(messages, verified).map((target) => target.value)).toEqual([
      ...contractPaths,
      ledgerPath,
    ]);
  });

  it("shows a verified card for 交付文件: CJK-bracket filenames without backticks", () => {
    const filename = "【视频脚本-栖光修护精华-晚晚要早睡】审核留痕版.docx";
    const finalText =
      `已生成完毕。\n\n交付文件：${filename} （当前会话目录下，43816 字节）`;
    const messages = [message("msg_final", "assistant", finalText)] satisfies UIMessage[];
    const verified = [{ ...fileTarget(filename, "document"), exists: true }];

    expect(extractAssistantDeliveryManifestPaths(finalText)).toContain(filename);
    expect(deriveOpenTargets(messages).map((target) => target.value)).toContain(filename);
    expect(selectTurnOpenTargets(messages, verified).map((target) => target.value)).toEqual([
      filename,
    ]);
  });

  it("does not treat arbitrary code-spanned file mentions as a delivery manifest", () => {
    const text = "我参考了 `输入台账.xlsx`，但还没有开始生成文件。";

    expect(extractAssistantDeliveryManifestPaths(text)).toEqual([]);
    expect(deriveOpenTargets([message("msg_1", "assistant", text)])).toEqual([]);
  });

  it("does not let final delivery context promote earlier assistant file mentions", () => {
    const messages = [
      message("msg_progress", "assistant", "正在读取 `用户输入.xlsx`。"),
      message("msg_final", "assistant", "交付物：`最终输出.xlsx`。"),
    ] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("用户输入.xlsx", "sheet"), exists: true },
      { ...fileTarget("最终输出.xlsx", "sheet"), exists: true },
    ];

    expect(selectTurnOpenTargets(messages, verified).map((target) => target.value)).toEqual([
      "最终输出.xlsx",
    ]);
  });

  it("keeps hidden temporary data files out of the user-facing artifact cards", () => {
    const messages = [
      toolMessage(
        "msg_tmp",
        "write",
        { filePath: ".opencode/tmp/intermediate.json" },
        { filePath: ".opencode/tmp/intermediate.json" },
      ),
      toolMessage(
        "msg_final_file",
        "write",
        { filePath: "output/report.xlsx" },
        { filePath: "output/report.xlsx" },
      ),
      message("msg_final", "assistant", "报表已生成。"),
    ] satisfies UIMessage[];
    const verified = [
      { ...fileTarget(".opencode/tmp/intermediate.json", "text"), exists: true },
      { ...fileTarget("output/report.xlsx", "sheet"), exists: true },
    ];

    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.value),
    ).toEqual(["output/report.xlsx"]);
  });

  it("shows only files written in the current assistant turn", () => {
    const messages = [
      toolMessage(
        "msg_tool",
        "write",
        { filePath: "本轮生成的报价结果.xlsx" },
        { filePath: "本轮生成的报价结果.xlsx" },
      ),
      message(
        "msg_final",
        "assistant",
        "已根据 用户上传的完整业务.xlsx 生成 本轮生成的报价结果.xlsx。",
      ),
    ] satisfies UIMessage[];
    const verified = [
      {
        ...fileTarget("/workspace/用户上传的完整业务.xlsx"),
        exists: true,
      },
      {
        ...fileTarget("/workspace/上一轮生成的报价.xlsx"),
        exists: true,
      },
      {
        ...fileTarget("/workspace/本轮生成的报价结果.xlsx"),
        exists: true,
      },
    ];

    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.value),
    ).toEqual(["/workspace/本轮生成的报价结果.xlsx"]);
  });

  it("does not auto-open generated html files or localhost browser previews", () => {
    const targets = deriveOpenTargets([
      toolMessage("msg_tool", "write", { filePath: "public/index.html" }, { filePath: "public/index.html" }),
      message("msg_1", "assistant", "Created public/index.html. API: `http://localhost:3000/api/info`. App: `http://localhost:3000`."),
    ]).map((target) => ({ ...target, exists: target.kind === "url" || target.value === "public/index.html" }));

    expect(targets.map((target) => target.value)).toContain("http://localhost:3000/api/info");
    expect(targets.map((target) => target.value)).toContain("http://localhost:3000");
    expect(selectAutoOpenTarget(targets)).toBeNull();
  });

  it("normalizes escaped localhost root URL variants into one target", () => {
    const targets = deriveOpenTargets([
      message("msg_1", "assistant", "App: `http://localhost:3000/\\` and also http://localhost:3000//"),
    ]);

    expect(targets.filter((target) => target.value === "http://localhost:3000")).toHaveLength(1);
    expect(targets.map((target) => target.name)).not.toContain("\\");
  });

  it("keeps accessible targets from earlier session messages", () => {
    const targets = deriveOpenTargets([
      toolMessage("msg_tool", "write", { filePath: "reports/earlier.csv" }, { filePath: "reports/earlier.csv" }),
      message("msg_1", "assistant", "Created reports/earlier.csv"),
      ...Array.from({ length: 12 }, (_, index) => message(`msg_noise_${index}`, "assistant", `Status update ${index + 1}`)),
      message("msg_last", "assistant", "Server running at http://localhost:3000"),
    ]);

    expect(targets.map((target) => target.value)).toContain("reports/earlier.csv");
    expect(targets.map((target) => target.value)).toContain("http://localhost:3000");
  });

  it("does not auto-open high-confidence deliverables or browser previews", () => {
    const targets = deriveOpenTargets([
      toolMessage("msg_tool", "write", { filePath: "data/customers.csv" }, { filePath: "data/customers.csv" }),
      message("msg_1", "assistant", "Created data/customers.csv and see https://example.com for docs."),
    ]);
    const csv = targets.find((target) => target.value === "data/customers.csv");
    const externalUrl = targets.find((target) => target.value === "https://example.com");

    expect(csv && shouldAutoOpenTarget({ ...csv, exists: true })).toBe(false);
    expect(csv && shouldAutoOpenTarget({ ...csv, exists: false })).toBe(false);
    expect(externalUrl && shouldAutoOpenTarget(externalUrl)).toBe(false);
  });

  it("collects Unicode workspace file paths from assistant mentions when enabled", () => {
    const withMentions = deriveOpenTargets(
      [
        message(
          "msg_1",
          "assistant",
          "已生成 agents/应收台账模板.xlsx（工作区根目录，43 KB）。",
        ),
      ],
      { includeFileMentions: true },
    );
    expect(withMentions.map((target) => target.value)).toContain(
      "agents/应收台账模板.xlsx",
    );
    expect(
      withMentions.find((target) => target.value === "agents/应收台账模板.xlsx")
        ?.preview,
    ).toBe("sheet");

    // Default (mentions off) must not invent file targets from prose alone.
    const withoutMentions = deriveOpenTargets([
      message("msg_2", "assistant", "已生成 agents/应收台账模板.xlsx"),
    ]);
    expect(withoutMentions.map((target) => target.value)).not.toContain(
      "agents/应收台账模板.xlsx",
    );
  });

  it("collects spreadsheet paths from write-like bash outputs only", () => {
    const targets = deriveOpenTargets([
      toolMessage(
        "msg_tool",
        "bash",
        { command: "python gen_xlsx.py" },
        "Wrote agents/ledger.xlsx\n",
      ),
    ]);
    expect(targets.map((target) => target.value)).toContain("agents/ledger.xlsx");
  });

  it("collects paths from first-class extract-sheets runtime command", () => {
    const targets = deriveOpenTargets([
      toolMessage(
        "msg_tool",
        "bash",
        {
          command:
            "node runtime/artifact_runtime.cjs extract-sheets source.xlsx --sheet 发货需求 --out 发货需求.xlsx",
        },
        JSON.stringify({
          status: "success",
          wrote: ["发货需求.xlsx"],
          message: "Wrote 发货需求.xlsx",
        }) + "\nWrote 发货需求.xlsx\n",
      ),
    ]);
    expect(targets.map((target) => target.value)).toContain("发货需求.xlsx");
  });

  it("does not treat artifact_runtime inspect/read as writes", () => {
    const targets = deriveOpenTargets([
      toolMessage(
        "msg_tool",
        "bash",
        {
          command: "node runtime/artifact_runtime.cjs inspect session-uploads/upload.xlsx",
        },
        JSON.stringify({
          status: "success",
          source: "session-uploads/1785468349196-0-upload.xlsx",
        }),
      ),
    ]);
    expect(targets.map((target) => target.value)).not.toContain(
      "session-uploads/1785468349196-0-upload.xlsx",
    );
  });

  it("does not treat shell inspect/find of a user upload as a generated artifact", () => {
    // Root cause of upload cards: bash was classified as a write tool, so any
    // path in inspect/find stdout (including session-uploads/…) became a card.
    const upload =
      ".opencode/onmyagent/inbox/session-uploads/1785468349196-0-07-四Agent完整业务演练材料.xlsx";
    const targets = deriveOpenTargets([
      toolMessage(
        "msg_inspect",
        "bash",
        {
          command: `node runtime/artifact_runtime.cjs inspect ${upload}`,
        },
        JSON.stringify({
          status: "success",
          source: `/Users/demo/work/${upload}`,
          sheet_count: 12,
        }),
      ),
      toolMessage(
        "msg_find",
        "bash",
        { command: "find . -name '*.xlsx'" },
        `${upload}\n发货需求.xlsx\n`,
      ),
      toolMessage(
        "msg_write",
        "bash",
        { command: "node extract_sheets.cjs" },
        "Wrote 发货需求.xlsx\nWrote 报价补充.xlsx\n",
      ),
    ]);
    const values = targets.map((target) => target.value);
    expect(values.some((value) => value.includes("session-uploads"))).toBe(false);
    expect(values.some((value) => value.includes("1785468349196"))).toBe(false);
    expect(values).toContain("发货需求.xlsx");
    expect(values).toContain("报价补充.xlsx");
  });

  it("hides process helper scripts when declared xlsx are the real deliverables", () => {
    // Screenshot regression: only extract_sheets.cjs card while body lists
    // 文件路径: …/发货需求.xlsx and …/报价补充.xlsx.
    const ship =
      "/Users/demo/.onmyagent/workspaces/货运客服专家/sid/session-uploads/upload.xlsx/发货需求.xlsx";
    const quote =
      "/Users/demo/.onmyagent/workspaces/货运客服专家/sid/session-uploads/upload.xlsx/报价补充.xlsx";
    const messages = [
      toolMessage(
        "msg_tool",
        "write",
        { filePath: "extract_sheets.cjs" },
        { filePath: "extract_sheets.cjs" },
      ),
      toolMessage(
        "msg_run",
        "bash",
        { command: "node extract_sheets.cjs" },
        "done\n",
      ),
      message(
        "msg_final",
        "assistant",
        `发货需求表与报价补充已生成。\n文件路径: ${ship}\n文件路径: ${quote}`,
      ),
    ] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("extract_sheets.cjs", "text"), exists: true },
      { ...fileTarget(ship, "sheet"), exists: true },
      { ...fileTarget(quote, "sheet"), exists: true },
    ];
    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.name).sort(),
    ).toEqual(["发货需求.xlsx", "报价补充.xlsx"].sort());
  });

  it("hides process helper scripts when a business file is the real deliverable", () => {
    const messages = [
      toolMessage(
        "msg_tool",
        "write",
        { filePath: "extract_sheets.cjs" },
        { filePath: "extract_sheets.cjs" },
      ),
      toolMessage(
        "msg_run",
        "bash",
        { command: "node extract_sheets.cjs" },
        "Wrote 发货需求与报价补充.xlsx\n",
      ),
      toolMessage(
        "msg_xlsx",
        "write",
        { filePath: "发货需求与报价补充.xlsx" },
        { filePath: "发货需求与报价补充.xlsx" },
      ),
      message(
        "msg_final",
        "assistant",
        "文件路径：发货需求与报价补充.xlsx",
      ),
    ] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("extract_sheets.cjs", "text"), exists: true },
      { ...fileTarget("发货需求与报价补充.xlsx", "sheet"), exists: true },
      { ...fileTarget("preview.png", "image"), exists: true },
    ];
    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.value),
    ).toEqual(["发货需求与报价补充.xlsx"]);
  });

  it("hides unnamed process helpers that were only written (not declared)", () => {
    const messages = [
      toolMessage(
        "msg_tool",
        "write",
        { filePath: "extract_sheets.cjs" },
        { filePath: "extract_sheets.cjs" },
      ),
      message("msg_final", "assistant", "已完成，校验通过。"),
    ] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("extract_sheets.cjs", "text"), exists: true },
    ];
    expect(selectTurnOpenTargets(messages, verified)).toEqual([]);
  });

  it("shows intentional code deliverables when declared as 文件路径", () => {
    const messages = [
      toolMessage(
        "msg_tool",
        "write",
        { filePath: "export_orders.py" },
        { filePath: "export_orders.py" },
      ),
      message(
        "msg_final",
        "assistant",
        "脚本写好了。\n文件路径：export_orders.py",
      ),
    ] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("export_orders.py", "text"), exists: true },
    ];
    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.value),
    ).toEqual(["export_orders.py"]);
  });

  it("shows png/html/txt content deliverables from write tools", () => {
    const messages = [
      toolMessage("msg_1", "write", { filePath: "chart.png" }, { filePath: "chart.png" }),
      toolMessage("msg_2", "write", { filePath: "summary.html" }, { filePath: "summary.html" }),
      toolMessage("msg_3", "write", { filePath: "notes.txt" }, { filePath: "notes.txt" }),
      message("msg_final", "assistant", "图和摘要都生成好了。"),
    ] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("chart.png", "image"), exists: true },
      { ...fileTarget("summary.html", "html"), exists: true },
      { ...fileTarget("notes.txt", "text"), exists: true },
    ];
    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.value).sort(),
    ).toEqual(["chart.png", "notes.txt", "summary.html"].sort());
  });

  it("drops inbox-style user upload basenames from derived targets", () => {
    const targets = deriveOpenTargets([
      toolMessage(
        "msg_tool",
        "write",
        { filePath: "1785466093426-0-07-四Agent完整业务演练材料.xlsx" },
        { filePath: "1785466093426-0-07-四Agent完整业务演练材料.xlsx" },
      ),
    ]);
    expect(targets.map((target) => target.value)).not.toContain(
      "1785466093426-0-07-四Agent完整业务演练材料.xlsx",
    );
  });

  it("mints product cards from ONMYAGENT_DELIVERABLE runtime registration", () => {
    const targets = deriveOpenTargets([
      toolMessage(
        "msg_tool",
        "bash",
        {
          command:
            "node runtime/artifact_runtime.cjs write-xlsx --out 运单账单合并对账表.xlsx --sheet 对账 --json /tmp/rows.json",
        },
        [
          JSON.stringify({
            status: "success",
            deliverable: true,
            path: "运单账单合并对账表.xlsx",
            wrote: ["运单账单合并对账表.xlsx"],
          }),
          "ONMYAGENT_DELIVERABLE: 运单账单合并对账表.xlsx",
          "Wrote 运单账单合并对账表.xlsx",
        ].join("\n"),
      ),
      message("msg_final", "assistant", "已合并完成，生成了「运单账单合并对账表.xlsx」"),
    ]);
    expect(targets.map((target) => target.value)).toContain("运单账单合并对账表.xlsx");
    expect(
      targets.find((target) => target.value === "运单账单合并对账表.xlsx")?.reason,
    ).toBe("runtime deliverable");
  });

  it("shows a verified deliverable registered in the final assistant reply", () => {
    const messages = [
      message(
        "msg_final",
        "assistant",
        [
          "验证通过，已生成《澄露防晒乳_返点毛利与投放效果分析.xlsx》。",
          "ONMYAGENT_DELIVERABLE: 澄露防晒乳_返点毛利与投放效果分析.xlsx",
        ].join("\n"),
      ),
    ] satisfies UIMessage[];
    const verified = [
      {
        ...fileTarget("澄露防晒乳_返点毛利与投放效果分析.xlsx", "sheet"),
        exists: true,
      },
    ];

    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.value),
    ).toEqual(["澄露防晒乳_返点毛利与投放效果分析.xlsx"]);
  });

  it("shows a verified deliverable when the final marker is Markdown bold", () => {
    const messages = [
      message(
        "msg_final",
        "assistant",
        [
          "## ✅ 交付完成",
          "**ONMYAGENT_DELIVERABLE: 云雾轻乳_项目Brief与待确认项.docx**",
        ].join("\n"),
      ),
    ] satisfies UIMessage[];
    const verified = [
      {
        ...fileTarget("云雾轻乳_项目Brief与待确认项.docx", "document"),
        exists: true,
      },
    ];

    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.value),
    ).toEqual(["云雾轻乳_项目Brief与待确认项.docx"]);
  });

  it("mints product cards from helper-script SAVED: lines for any deliverable type", () => {
    const paths = collectRuntimeRegisteredDeliverablePaths(
      { command: "python3 /tmp/oma-export.py" },
      [
        "SAVED: 返点毛利计划单.xlsx",
        "SAVED: 合同摘要.docx",
        "SAVED: 核对说明.pdf",
        "SAVED: 封面.png",
      ].join("\n"),
    );
    expect(paths).toEqual([
      "返点毛利计划单.xlsx",
      "合同摘要.docx",
      "核对说明.pdf",
      "封面.png",
    ]);

    const targets = deriveOpenTargets([
      toolMessage(
        "msg_tool",
        "bash",
        { command: "python3 /var/folders/xx/oma-export.py" },
        [
          "SAVED: 返点毛利计划单.xlsx",
          "SAVED: 合同摘要.docx",
          "SAVED: 核对说明.pdf",
          "SAVED: 封面.png",
        ].join("\n"),
      ),
      message("msg_final", "assistant", "文件都已生成在工作区根目录。"),
    ]);
    expect(targets.map((target) => target.value)).toEqual([
      "返点毛利计划单.xlsx",
      "合同摘要.docx",
      "核对说明.pdf",
      "封面.png",
    ]);
  });

  it("shows verified files listed as bare lines after a delivery sentence", () => {
    const text = [
      "已拆成三个独立文件，可直接打开使用：",
      "",
      "返点毛利计划单.xlsx（A1:O13）",
      "合同摘要.docx",
      "核对说明.pdf",
    ].join("\n");
    expect(extractAssistantDeliveryManifestPaths(text).sort()).toEqual(
      ["合同摘要.docx", "核对说明.pdf", "返点毛利计划单.xlsx"].sort(),
    );
    const messages = [message("msg_final", "assistant", text)] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("返点毛利计划单.xlsx", "sheet"), exists: true },
      { ...fileTarget("合同摘要.docx", "document"), exists: true },
      { ...fileTarget("核对说明.pdf", "pdf"), exists: true },
    ];
    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.value).sort(),
    ).toEqual(["合同摘要.docx", "核对说明.pdf", "返点毛利计划单.xlsx"].sort());
  });

  it("collects write-xlsx --out even when stdout only has the marker", () => {
    const paths = collectRuntimeRegisteredDeliverablePaths(
      {
        command:
          "node runtime/artifact_runtime.cjs write-xlsx --out 合并对账.xlsx --sheet S --json /tmp/a.json",
      },
      "ONMYAGENT_DELIVERABLE: 合并对账.xlsx\n",
    );
    expect(paths).toContain("合并对账.xlsx");
  });

  it("mints product cards from OfficeCLI create with deliverable markers", () => {
    const targets = deriveOpenTargets([
      toolMessage(
        "msg_tool",
        "bash",
        { command: "officecli create report.docx" },
        [
          "Created: report.docx (kept open in background for faster subsequent commands)",
          "ONMYAGENT_DELIVERABLE: report.docx",
        ].join("\n"),
      ),
      message("msg_final", "assistant", "已创建 Word 文档。"),
    ]);
    expect(targets.map((target) => target.value)).toContain("report.docx");
  });

  it("collects OfficeCLI mutating command file paths without markers", () => {
    const paths = collectRuntimeRegisteredDeliverablePaths(
      { command: "officecli create slides.pptx --force" },
      "Created: slides.pptx (kept open)\n",
    );
    expect(paths).toContain("slides.pptx");
  });

  it("collects OfficeCLI merge output (not template) as deliverable", () => {
    const paths = collectRuntimeRegisteredDeliverablePaths(
      {
        command:
          'officecli merge 批准模板.docx "合同输出/返点合同_A.docx" --data row.json --force',
      },
      JSON.stringify({
        success: true,
        data: { output: "合同输出/返点合同_A.docx", replacedKeys: 3 },
        message: "Merged 3 key(s)",
      }),
    );
    expect(paths).toContain("合同输出/返点合同_A.docx");
    expect(paths).not.toContain("批准模板.docx");
  });

  it("mints product cards from merge ONMYAGENT_DELIVERABLE markers", () => {
    const targets = deriveOpenTargets([
      toolMessage(
        "msg_tool",
        "bash",
        {
          command:
            "officecli merge template.docx 合同输出/out.docx --data row.json --force",
        },
        [
          JSON.stringify({
            success: true,
            data: { output: "合同输出/out.docx" },
            message: "Merged 3 key(s)",
          }),
          "ONMYAGENT_DELIVERABLE: 合同输出/out.docx",
        ].join("\n"),
      ),
      message("msg_final", "assistant", "已生成返点合同。"),
    ]);
    expect(targets.map((target) => target.value)).toContain("合同输出/out.docx");
  });

  it("resolves batch deliverable markers against an explicit shell working directory", () => {
    const paths = collectRuntimeRegisteredDeliverablePaths(
      {
        command:
          'cd "/tmp/session/合同输出" && for file in *.docx; do officecli set "$file" / --find old --replace new; done',
      },
      [
        "ONMYAGENT_DELIVERABLE: 合同一.docx",
        "ONMYAGENT_DELIVERABLE: 合同二.docx",
        "ONMYAGENT_DELIVERABLE: 合同三.docx",
      ].join("\n"),
    );

    expect(paths).toEqual([
      "/tmp/session/合同输出/合同一.docx",
      "/tmp/session/合同输出/合同二.docx",
      "/tmp/session/合同输出/合同三.docx",
    ]);
  });

  it("shows pdf/html/md content deliverables written by write tools", () => {
    const messages = [
      toolMessage("msg_pdf", "write", { filePath: "回单核对.pdf" }, { filePath: "回单核对.pdf" }),
      toolMessage("msg_html", "write", { filePath: "进度看板.html" }, { filePath: "进度看板.html" }),
      toolMessage("msg_md", "write", { filePath: "客户通知草稿.md" }, { filePath: "客户通知草稿.md" }),
      message("msg_final", "assistant", "文件都写好了，可在下方产物卡打开。"),
    ] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("回单核对.pdf", "pdf"), exists: true },
      { ...fileTarget("进度看板.html", "html"), exists: true },
      { ...fileTarget("客户通知草稿.md", "markdown"), exists: true },
    ];
    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.value).sort(),
    ).toEqual(["回单核对.pdf", "客户通知草稿.md", "进度看板.html"].sort());
  });

  it("shows verified soft prose claims when tool provenance is unavailable", () => {
    const messages = [
      message(
        "msg_followup",
        "assistant",
        "已合并完成，生成了「运单账单合并对账表.xlsx」，含两张表。",
      ),
    ] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("运单账单合并对账表.xlsx", "sheet"), exists: true, size: 18_400 },
    ];
    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.value),
    ).toEqual(["运单账单合并对账表.xlsx"]);
  });

  it("shows listed xlsx files from a space-session delivery summary", () => {
    const messages = [
      message(
        "msg_space",
        "assistant",
        [
          "已拆出四个独立 Excel 文件，均保存在 C:\\Users\\hopef\\OneDrive\\Desktop\\work\\ ：",
          "",
          "- 项目目标与口径.xlsx",
          "- 发布效果.xlsx",
          "- 点位周报.xlsx",
          "- 投流内容明细.xlsx",
        ].join("\n"),
      ),
    ] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("项目目标与口径.xlsx", "sheet"), exists: true },
      { ...fileTarget("发布效果.xlsx", "sheet"), exists: true },
      { ...fileTarget("点位周报.xlsx", "sheet"), exists: true },
      { ...fileTarget("投流内容明细.xlsx", "sheet"), exists: true },
    ];
    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.name).sort(),
    ).toEqual(
      ["发布效果.xlsx", "投流内容明细.xlsx", "点位周报.xlsx", "项目目标与口径.xlsx"].sort(),
    );
  });

  it("shows listed xlsx files when the delivery bullets include size notes", () => {
    const text = [
      "已把原工作簿的 4 个 sheet 拆成 4 个独立文件，行数/列数/非空单元格均与源表一致，无公式错误：",
      "",
      "- 项目目标与口径.xlsx (8 行 × 4 列)",
      "- 发布效果.xlsx (9 行 × 16 列)",
      "- 点位周报.xlsx (7 行 × 9 列)",
      "- 投流内容明细.xlsx (15 行 × 13 列)",
    ].join("\n");
    expect(extractAssistantDeliveryManifestPaths(text).sort()).toEqual(
      ["发布效果.xlsx", "投流内容明细.xlsx", "点位周报.xlsx", "项目目标与口径.xlsx"].sort(),
    );
    const messages = [message("msg_final", "assistant", text)] satisfies UIMessage[];
    const verified = [
      { ...fileTarget("output/项目目标与口径.xlsx", "sheet"), exists: true },
      { ...fileTarget("output/发布效果.xlsx", "sheet"), exists: true },
      { ...fileTarget("output/点位周报.xlsx", "sheet"), exists: true },
      { ...fileTarget("output/投流内容明细.xlsx", "sheet"), exists: true },
    ];
    expect(
      selectTurnOpenTargets(messages, verified).map((target) => target.name).sort(),
    ).toEqual(
      ["发布效果.xlsx", "投流内容明细.xlsx", "点位周报.xlsx", "项目目标与口径.xlsx"].sort(),
    );
  });
});

describe("resolveArtifactAbsolutePath", () => {
  it("returns absolute paths unchanged", () => {
    expect(resolveArtifactAbsolutePath("/tmp/out/a.pdf", "/ws")).toBe("/tmp/out/a.pdf");
    expect(resolveArtifactAbsolutePath("C:\\Work\\a.pdf", "D:\\ws")).toBe("C:\\Work\\a.pdf");
  });

  it("joins session-relative paths under the session directory root", () => {
    expect(
      resolveArtifactAbsolutePath(
        "output/物流单.pdf",
        "/Users/me/ws/order-entry-clerk/abc123",
      ),
    ).toBe("/Users/me/ws/order-entry-clerk/abc123/output/物流单.pdf");
  });

  it("keeps macOS Application Support paths as one absolute file", () => {
    const isolated =
      "/Users/me/Library/Application Support/com.differential.onmyagent/expert-sessions/ws/agent/1753456789000";
    const abs = `${isolated}/output/点位周报.xlsx`;
    expect(resolveArtifactAbsolutePath(abs, isolated)).toBe(abs);
    expect(
      deriveOpenTargets([
        {
          id: "msg_1",
          role: "assistant",
          parts: [{ type: "text", text: `已写入 ${abs}` }],
        },
      ], { includeFileMentions: true }).map((target) => target.value),
    ).toContain(abs);
  });

  it("joins catalog-relative paths under the workspace catalog root", () => {
    expect(
      resolveArtifactAbsolutePath(
        "order-entry-clerk/abc123/output/物流单.pdf",
        "/Users/me/ws",
      ),
    ).toBe("/Users/me/ws/order-entry-clerk/abc123/output/物流单.pdf");
  });

  it("dedupes when session root is joined with catalog-relative values", () => {
    // Common failure mode: surface.workspaceRoot is the isolated session dir,
    // while resolveArtifacts returns paths relative to the workspace catalog.
    expect(
      resolveArtifactAbsolutePath(
        "order-entry-clerk/abc123/output/物流单.pdf",
        "/Users/me/ws/order-entry-clerk/abc123",
      ),
    ).toBe("/Users/me/ws/order-entry-clerk/abc123/output/物流单.pdf");
  });

  it("builds reveal candidates preferring verified catalog-relative values", () => {
    const candidates = resolveArtifactRevealCandidates("output/物流单.pdf", {
      workspaceRoot: "/Users/me/ws/order-entry-clerk/abc123",
      verifiedValue: "order-entry-clerk/abc123/output/物流单.pdf",
    });
    expect(candidates[0]).toBe("/Users/me/ws/order-entry-clerk/abc123/output/物流单.pdf");
    expect(candidates).toContain("/Users/me/ws/order-entry-clerk/abc123/output/物流单.pdf");
  });
});
