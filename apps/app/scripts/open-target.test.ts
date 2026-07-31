import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";

import {
  canPreviewOpenTargetInline,
  classifyOpenTarget,
  deriveOpenTargets,
  isCollectibleArtifactTarget,
  isUserFacingLocalPreviewTarget,
  resolveArtifactAbsolutePath,
  resolveArtifactRevealCandidates,
  selectAutoOpenTarget,
  shouldAutoOpenTarget,
  type OpenTarget,
} from "../src/react-app/domains/session/artifacts/open-target";
import { selectTurnOpenTargets } from "../src/react-app/domains/session/surface/message-list";
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

  it("shows verified deliverables when assistant declares 文件路径 / 已生成", () => {
    const messages = [
      message(
        "msg_final",
        "assistant",
        "已完成。\n\n交付\n文件路径：发货需求与报价补充.xlsx（工作目录根下）",
      ),
    ] satisfies UIMessage[];
    const verified = [{
      ...fileTarget(
        "/Users/demo/work/货运客服专家/1785423406407/发货需求与报价补充.xlsx",
        "sheet",
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

  it("ignores casual file mentions without deliverable wording", () => {
    const messages = [
      message(
        "msg_final",
        "assistant",
        "可以参考 历史报价.xlsx 里的口径，我还没生成新文件。",
      ),
    ] satisfies UIMessage[];
    const verified = [{
      ...fileTarget("/Users/demo/work/历史报价.xlsx", "sheet"),
      exists: true,
    }];
    expect(selectTurnOpenTargets(messages, verified)).toEqual([]);
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

  it("does not mint artifact cards from pure find/ls shell listings", () => {
    const targets = deriveOpenTargets([
      toolMessage(
        "msg_tool",
        "bash",
        { command: "find . -name '*.xlsx'" },
        "1785466093426-0-07-四Agent完整业务演练材料.xlsx\nagents/ledger.xlsx\n",
      ),
    ]);
    expect(targets.map((target) => target.value)).not.toContain(
      "1785466093426-0-07-四Agent完整业务演练材料.xlsx",
    );
    expect(targets.map((target) => target.value)).not.toContain("agents/ledger.xlsx");
  });

  it("collects spreadsheet paths from write-like shell script output", () => {
    const targets = deriveOpenTargets([
      toolMessage(
        "msg_tool",
        "bash",
        { command: "node gen_xlsx.cjs" },
        "Wrote 发货需求与报价补充.xlsx\n",
      ),
    ]);
    expect(targets.map((target) => target.value)).toContain("发货需求与报价补充.xlsx");
  });

  it("still collects paths from real write-tool metadata", () => {
    const targets = deriveOpenTargets([
      toolMessage(
        "msg_tool",
        "write",
        { filePath: "agents/ledger.xlsx" },
        { filePath: "agents/ledger.xlsx" },
      ),
    ]);
    expect(targets.map((target) => target.value)).toContain("agents/ledger.xlsx");
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
