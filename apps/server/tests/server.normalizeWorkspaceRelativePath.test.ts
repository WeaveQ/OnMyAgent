import { describe, expect, test } from "bun:test";
import { isSupportedWorkspaceTextFilePath, normalizeWorkspaceRelativePath } from "../src/server.js";
import { contentKindForPath, contentTypeForPath } from "../src/workspace/path-utils.js";

describe("normalizeWorkspaceRelativePath", () => {
  test("accepts a plain workspace-relative path", () => {
    expect(normalizeWorkspaceRelativePath("notes.md", { allowSubdirs: true })).toBe("notes.md");
  });

  test("strips workspace/ prefix", () => {
    expect(normalizeWorkspaceRelativePath("workspace/notes.md", { allowSubdirs: true })).toBe("notes.md");
    expect(normalizeWorkspaceRelativePath("workspace/dir/notes.md", { allowSubdirs: true })).toBe("dir/notes.md");
  });

  test("strips Workspace/<id>/ prefix from rendered artifact paths", () => {
    expect(normalizeWorkspaceRelativePath("Workspace/32423/reports/artifact-eval.md", { allowSubdirs: true })).toBe("reports/artifact-eval.md");
    expect(normalizeWorkspaceRelativePath("workspaces/demo/reports/artifact-eval.csv", { allowSubdirs: true })).toBe("reports/artifact-eval.csv");
  });

  test("strips /workspace/ prefix", () => {
    expect(normalizeWorkspaceRelativePath("/workspace/notes.md", { allowSubdirs: true })).toBe("notes.md");
    expect(normalizeWorkspaceRelativePath("//workspace/dir/notes.md", { allowSubdirs: true })).toBe("dir/notes.md");
  });

  test("strips ./workspace/ prefix", () => {
    expect(normalizeWorkspaceRelativePath("./workspace/notes.md", { allowSubdirs: true })).toBe("notes.md");
  });

  test("still rejects traversal after stripping prefixes", () => {
    expect(() => normalizeWorkspaceRelativePath("workspace/../secrets.md", { allowSubdirs: true })).toThrow();
    expect(() => normalizeWorkspaceRelativePath("/workspace/../secrets.md", { allowSubdirs: true })).toThrow();
  });

  test("still enforces allowSubdirs", () => {
    expect(() => normalizeWorkspaceRelativePath("workspace/dir/notes.md", { allowSubdirs: false })).toThrow();
  });

  test("treats workspace/ with no file as invalid", () => {
    expect(() => normalizeWorkspaceRelativePath("workspace/", { allowSubdirs: true })).toThrow();
    expect(() => normalizeWorkspaceRelativePath("/workspace/", { allowSubdirs: true })).toThrow();
  });
});

describe("isSupportedWorkspaceTextFilePath", () => {
  test("accepts workspace text artifact extensions", () => {
    expect(isSupportedWorkspaceTextFilePath("reports/revenue.csv")).toBe(true);
    expect(isSupportedWorkspaceTextFilePath("reports/revenue.tsv")).toBe(true);
    expect(isSupportedWorkspaceTextFilePath("logs/run.log")).toBe(true);
    expect(isSupportedWorkspaceTextFilePath("config/app.yaml")).toBe(true);
    expect(isSupportedWorkspaceTextFilePath("styles/app.css")).toBe(true);
    expect(isSupportedWorkspaceTextFilePath("dist/index.html")).toBe(true);
    expect(isSupportedWorkspaceTextFilePath("scripts/report.py")).toBe(true);
    expect(isSupportedWorkspaceTextFilePath("src/main.rs")).toBe(true);
    expect(isSupportedWorkspaceTextFilePath("src/main.go")).toBe(true);
    expect(isSupportedWorkspaceTextFilePath("src/Main.java")).toBe(true);
    expect(isSupportedWorkspaceTextFilePath("scripts/build.sh")).toBe(true);
    expect(isSupportedWorkspaceTextFilePath("queries/report.sql")).toBe(true);
    expect(isSupportedWorkspaceTextFilePath("config/app.ini")).toBe(true);
    expect(isSupportedWorkspaceTextFilePath("src/App.vue")).toBe(true);
    expect(isSupportedWorkspaceTextFilePath("schema/query.graphql")).toBe(true);
  });

  test("keeps accepting OpenCode config/plugin text file extensions", () => {
    expect(isSupportedWorkspaceTextFilePath(".opencode/tools/cloud.ts")).toBe(true);
    expect(isSupportedWorkspaceTextFilePath(".opencode/mcps/cloud.json")).toBe(true);
    expect(isSupportedWorkspaceTextFilePath(".opencode/plugins/cloud.txt")).toBe(true);
  });

  test("rejects unsupported binary-like extensions", () => {
    expect(isSupportedWorkspaceTextFilePath(".opencode/plugins/cloud.bin")).toBe(false);
  });
});

describe("workspace media metadata", () => {
  test("serves MP3 and MP4 with browser-playable content types", () => {
    expect(contentTypeForPath("recordings/meeting.mp3")).toBe("audio/mpeg");
    expect(contentTypeForPath("videos/demo.mp4")).toBe("video/mp4");
  });

  test("keeps media files outside the text-reading path", () => {
    expect(contentKindForPath("recordings/meeting.mp3")).toBe("binary");
    expect(contentKindForPath("videos/demo.mp4")).toBe("binary");
  });
});
