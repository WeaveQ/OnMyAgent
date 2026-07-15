import { describe, expect, test } from "bun:test";

import { parseMarkdownCodeFenceInfo } from "../src/react-app/capabilities/artifacts/markdown";

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
});
