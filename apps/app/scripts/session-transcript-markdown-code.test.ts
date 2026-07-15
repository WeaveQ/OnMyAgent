import { describe, expect, test } from "bun:test";

import {
  parseMarkdownCodeFenceInfo,
  parseMarkdownInlinePath,
  truncateMarkdownPathDisplay,
} from "../src/react-app/capabilities/artifacts/markdown";

describe("session transcript markdown code fences", () => {
  test("parses WorkBuddy language and file line metadata", () => {
    expect(parseMarkdownCodeFenceInfo("typescript:12:48:src/app.tsx")).toEqual({
      language: "typescript",
      filePath: "src/app.tsx",
      fileName: "app.tsx",
      startLine: 12,
      endLine: 48,
    });
    expect(parseMarkdownCodeFenceInfo("tsx:8-16:src/view.tsx")).toEqual({
      language: "tsx",
      filePath: "src/view.tsx",
      fileName: "view.tsx",
      startLine: 8,
      endLine: 16,
    });
  });

  test("parses file line metadata without an explicit language", () => {
    expect(parseMarkdownCodeFenceInfo("2:9:README.md")).toEqual({
      language: "",
      filePath: "README.md",
      fileName: "README.md",
      startLine: 2,
      endLine: 9,
    });
  });

  test("keeps ordinary code fence languages unchanged", () => {
    expect(parseMarkdownCodeFenceInfo("python")).toEqual({
      language: "python",
      filePath: null,
      fileName: null,
      startLine: null,
      endLine: null,
    });
  });

  test("detects verified-file candidates and WorkBuddy line ranges", () => {
    expect(parseMarkdownInlinePath("src/react-app/App.tsx#L12-L20")).toEqual({
      path: "src/react-app/App.tsx",
      startLine: 12,
      endLine: 20,
    });
    expect(parseMarkdownInlinePath("README.md")).toEqual({
      path: "README.md",
      startLine: null,
      endLine: null,
    });
    expect(parseMarkdownInlinePath("useMemo")).toBeNull();
    expect(parseMarkdownInlinePath("not a path")).toBeNull();
  });

  test("keeps the filename visible when truncating long paths", () => {
    expect(truncateMarkdownPathDisplay("apps/app/src/react-app/domains/session/message-list.tsx", 32))
      .toBe("apps/app/src/...message-list.tsx");
  });
});
