import { describe, expect, test } from "bun:test";

import type { OpenworkWorkspaceFileCatalogEntry } from "../src/app/lib/onmyagent-server";
import {
  buildFileHierarchy,
  buildWorkspaceFileTree,
  filterHiddenFromTree,
  filterWorkspaceFileTree,
  findWorkspaceFileNode,
  formatWorkspaceFileSize,
  shouldHideEntry,
  workspaceNameFromRoot,
} from "../src/react-app/domains/session/chat/session-page-files-model";

function entry(path: string, kind: "file" | "dir" = "file", size = 100): OpenworkWorkspaceFileCatalogEntry {
  return { path, kind, size, mtimeMs: 1000 };
}

describe("session page files model", () => {
  test("formats workspace names and file sizes", () => {
    expect(workspaceNameFromRoot("/Users/work/project-a")).toBe("project-a");
    expect(workspaceNameFromRoot("C:\\Users\\work\\project-b")).toBe("project-b");
    expect(workspaceNameFromRoot("/")).toBe("Current workspace");

    expect(formatWorkspaceFileSize(-1)).toBe("0 B");
    expect(formatWorkspaceFileSize(0)).toBe("0 B");
    expect(formatWorkspaceFileSize(999)).toBe("999 B");
    expect(formatWorkspaceFileSize(1536)).toBe("1.5 KB");
    expect(formatWorkspaceFileSize(10 * 1024 * 1024)).toBe("10 MB");
  });

  test("builds sorted workspace file trees and finds nested nodes", () => {
    const tree = buildWorkspaceFileTree([
      entry("agent-b/task-1/output.txt"),
      entry("README.md"),
      entry("agent-a/task-2/result.json"),
      entry("agent-a/task-1/input.txt"),
    ]);

    expect(tree.children.map((child) => child.name)).toEqual(["agent-a", "agent-b", "README.md"]);
    expect(findWorkspaceFileNode(tree, "agent-a/task-1/input.txt")?.name).toBe("input.txt");
    expect(findWorkspaceFileNode(tree, "missing.txt")).toBeNull();
  });

  test("filters trees by name or path while preserving ancestors", () => {
    const tree = buildWorkspaceFileTree([
      entry("agent-a/task-1/input.txt"),
      entry("agent-a/task-2/result.json"),
      entry("agent-b/task-1/output.txt"),
    ]);

    const filtered = filterWorkspaceFileTree(tree, "result");
    expect(filtered?.children).toHaveLength(1);
    expect(filtered?.children[0]?.name).toBe("agent-a");
    expect(filtered?.children[0]?.children[0]?.name).toBe("task-2");
    expect(filterWorkspaceFileTree(tree, "missing")).toBeNull();
    expect(filterWorkspaceFileTree(tree, "  ")).toBe(tree);
  });

  test("hides dotfiles and opencode config entries", () => {
    expect(shouldHideEntry(".env")).toBe(true);
    expect(shouldHideEntry("agent/.cache/file.txt")).toBe(true);
    expect(shouldHideEntry("opencode.jsonc")).toBe(true);
    expect(shouldHideEntry("agent/opencode.jsonc")).toBe(true);
    expect(shouldHideEntry("agent/task/output.txt")).toBe(false);

    const tree = buildWorkspaceFileTree([
      entry("agent/.secret"),
      entry("agent/opencode.jsonc"),
      entry("agent/task/output.txt"),
    ]);
    expect(filterHiddenFromTree(tree).children[0]?.children.map((child) => child.name))
      .toEqual(["task"]);
  });

  test("groups root, agent, and task files for the workspace file hierarchy", () => {
    const groups = buildFileHierarchy([
      entry("README.md", "file", 50),
      entry("agent-a/profile.md", "file", 60),
      entry("agent-a/task-1/output.txt", "file", 70),
      entry("agent-a/task-1/nested/trace.log", "file", 80),
      entry("agent-a/.secret", "file", 90),
      entry("agent-b/task-2/opencode.jsonc", "file", 100),
    ]);

    expect(groups).toEqual([
      {
        agentName: "agent-a",
        taskName: "未分组",
        files: [{ name: "profile.md", path: "agent-a/profile.md", kind: "file", size: 60, mtimeMs: 1000 }],
      },
      {
        agentName: "agent-a",
        taskName: "task-1",
        files: [
          { name: "trace.log", path: "agent-a/task-1/nested/trace.log", kind: "file", size: 80, mtimeMs: 1000 },
          { name: "output.txt", path: "agent-a/task-1/output.txt", kind: "file", size: 70, mtimeMs: 1000 },
        ],
      },
      {
        agentName: "工作区根目录",
        taskName: "未分组",
        files: [{ name: "README.md", path: "README.md", kind: "file", size: 50, mtimeMs: 1000 }],
      },
    ]);
  });
});
