import { describe, expect, test } from "bun:test";

import {
  absolutePathFromFileUrl,
  fileUrlFromAbsolutePath,
  parseUserUploadInstructionBlock,
} from "../src/react-app/domains/session/surface/user-upload-display";

describe("user-upload-display", () => {
  test("strips model instruction and recovers file chips for historical messages", () => {
    const text = [
      "请分析这个表格",
      "",
      "The user uploaded the following files. Do not treat them as native model file inputs; if the task needs to process files, use local tools or the configured skill and read these local paths directly:",
      "- budget.xlsx (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet): /Users/me/ws/.opencode/onmyagent/inbox/session-uploads/budget.xlsx (workspace-relative path: .opencode/onmyagent/inbox/session-uploads/budget.xlsx)",
    ].join("\n");

    const parsed = parseUserUploadInstructionBlock(text);
    expect(parsed.remainingText).toBe("请分析这个表格");
    expect(parsed.files).toEqual([
      {
        name: "budget.xlsx",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        absolutePath:
          "/Users/me/ws/.opencode/onmyagent/inbox/session-uploads/budget.xlsx",
        relativePath: ".opencode/onmyagent/inbox/session-uploads/budget.xlsx",
      },
    ]);
  });

  test("file url helpers round-trip absolute paths", () => {
    expect(fileUrlFromAbsolutePath("/tmp/a.xlsx")).toBe("file:///tmp/a.xlsx");
    expect(absolutePathFromFileUrl("file:///tmp/a.xlsx")).toBe("/tmp/a.xlsx");
    // Plain absolute paths pass through for desktop reveal.
    expect(absolutePathFromFileUrl("/tmp/a.xlsx")).toBe("/tmp/a.xlsx");
  });

  test("recovers attachment chips from workspace-copy instructions with original paths", () => {
    const text = [
      "请批量生成合同",
      "",
      "The user uploaded the following files. Do not treat them as native model file inputs; if the task needs to process files, use local tools or the configured skill and read these local paths directly:",
      "- 模板.docx (application/vnd.openxmlformats-officedocument.wordprocessingml.document): workspace copy: /Users/me/work/uploads/1-0-模板.docx (workspace-relative path: uploads/1-0-模板.docx); original user-selected path: /Users/me/Downloads/模板.docx. Only modify this original path when the user explicitly asks to update, overwrite, or write back the source/original file",
      "- 台账.xlsx (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet): workspace copy: /Users/me/work/uploads/1-1-台账.xlsx (workspace-relative path: uploads/1-1-台账.xlsx); original user-selected path: /Users/me/Downloads/台账.xlsx. Only modify this original path when the user explicitly asks to update, overwrite, or write back the source/original file",
    ].join("\n");

    const parsed = parseUserUploadInstructionBlock(text);
    expect(parsed.remainingText).toBe("请批量生成合同");
    expect(parsed.files).toEqual([
      {
        name: "模板.docx",
        mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        absolutePath: "/Users/me/work/uploads/1-0-模板.docx",
        relativePath: "uploads/1-0-模板.docx",
        sourcePath: "/Users/me/Downloads/模板.docx",
      },
      {
        name: "台账.xlsx",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        absolutePath: "/Users/me/work/uploads/1-1-台账.xlsx",
        relativePath: "uploads/1-1-台账.xlsx",
        sourcePath: "/Users/me/Downloads/台账.xlsx",
      },
    ]);
  });
});
