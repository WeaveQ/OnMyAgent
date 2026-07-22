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
  });
});
