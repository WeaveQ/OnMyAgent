/**
 * Unit tests for Files continuity helpers (layout paths, title truncate, outline).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { WorkspaceFileTreeNode } from "../src/react-app/capabilities/artifacts/workspace-file-tree";
import {
  truncateDisplayTitle,
  resolveSessionDisplayTitle,
  SESSION_TITLE_MAX_CHARS,
} from "../src/react-app/domains/workspace/workspace-files-display";
import {
  WORKSPACE_EXPERTS_DIR,
  WORKSPACE_TASKS_DIR,
  WORKSPACE_UPLOADS_DIR,
  candidateSessionOwnedRoots,
  extractSessionIdFromProductPath,
  filterPathsUnderSessionRoots,
  isBareWorkspaceRootFile,
  isUnderProductLayoutRoot,
  resolveProductWriteRelativePath,
} from "../src/react-app/domains/workspace/workspace-files-layout";
import {
  inferAgentSlugFromDirectory,
  resolveSessionOwnedFilePaths,
} from "../src/react-app/domains/workspace/workspace-files-session-cleanup";
import { buildRootOutlineRows } from "../src/react-app/domains/workspace/workspace-files-model";

const appRoot = join(import.meta.dir, "..");

function readApp(rel: string) {
  return readFileSync(join(appRoot, rel), "utf8");
}

describe("truncateDisplayTitle", () => {
  test("leaves short titles unchanged", () => {
    const r = truncateDisplayTitle("报价作业");
    expect(r.truncated).toBe(false);
    expect(r.display).toBe("报价作业");
    expect(r.full).toBe("报价作业");
  });

  test("truncates long CJK titles to about 10 chars with ellipsis", () => {
    const full = "优化AI方案介绍幻灯片效果展示";
    const r = truncateDisplayTitle(full, SESSION_TITLE_MAX_CHARS);
    expect(r.truncated).toBe(true);
    expect(r.full).toBe(full);
    expect(r.display.endsWith("…")).toBe(true);
    expect([...r.display.replace(/…$/, "")].length).toBe(SESSION_TITLE_MAX_CHARS);
  });

  test("resolveSessionDisplayTitle prefers real title", () => {
    const r = resolveSessionDisplayTitle({
      sessionTitle: "研究 Obsidian 与 onmyagent 结合",
      folderFallback: "会话 · 07/26 09:38",
    });
    expect(r.full.startsWith("研究")).toBe(true);
    expect(r.display.length).toBeLessThanOrEqual(SESSION_TITLE_MAX_CHARS + 1);
  });
});

describe("product write paths", () => {
  test("never writes business files at bare workspace root", () => {
    const task = resolveProductWriteRelativePath({
      source: "assistant_task",
      fileName: "out.xlsx",
      sessionId: "ses_abc",
    });
    expect(task.startsWith(`${WORKSPACE_TASKS_DIR}/`)).toBe(true);
    expect(task.includes("ses_abc")).toBe(true);
    expect(isUnderProductLayoutRoot(task)).toBe(true);
    expect(isBareWorkspaceRootFile(task)).toBe(false);

    const upload = resolveProductWriteRelativePath({
      source: "user_upload",
      fileName: "note.md",
    });
    expect(upload).toBe(`${WORKSPACE_UPLOADS_DIR}/note.md`);

    const expert = resolveProductWriteRelativePath({
      source: "expert",
      fileName: "quote.json",
      sessionId: "ses_1",
      agentSlug: "quote-specialist",
    });
    expect(expert.startsWith(`${WORKSPACE_EXPERTS_DIR}/quote-specialist/ses_1/`)).toBe(
      true,
    );
  });

  test("session-owned roots and path filter for permanent delete", () => {
    const roots = candidateSessionOwnedRoots({
      sessionId: "ses_1",
      directory: "tasks/ses_1",
      agentSlug: "fleet",
    });
    expect(roots).toContain("tasks/ses_1");
    expect(roots).toContain("experts/fleet/ses_1");

    const owned = filterPathsUnderSessionRoots(
      [
        "tasks/ses_1/a.xlsx",
        "tasks/ses_2/b.xlsx",
        "experts/fleet/ses_1/c.json",
        "uploads/keep.md",
      ],
      roots,
    );
    expect(owned.sort()).toEqual(
      ["experts/fleet/ses_1/c.json", "tasks/ses_1/a.xlsx"].sort(),
    );

    const resolved = resolveSessionOwnedFilePaths({
      sessionId: "ses_1",
      directory: "tasks/ses_1",
      agentSlug: "fleet",
      catalogPaths: [
        "tasks/ses_1/a.xlsx",
        "tasks/ses_2/b.xlsx",
        "experts/fleet/ses_1/c.json",
        "uploads/keep.md",
      ],
    });
    expect(resolved.sort()).toEqual(
      ["experts/fleet/ses_1/c.json", "tasks/ses_1/a.xlsx"].sort(),
    );
    // Permanent delete must not touch Mine uploads.
    expect(resolved.some((p) => p.startsWith(`${WORKSPACE_UPLOADS_DIR}/`))).toBe(
      false,
    );
  });

  test("extractSessionIdFromProductPath and agent slug inference", () => {
    expect(extractSessionIdFromProductPath("tasks/ses_abc/out.xlsx")).toBe(
      "ses_abc",
    );
    expect(
      extractSessionIdFromProductPath("experts/quote-specialist/ses_1/q.json"),
    ).toBe("ses_1");
    expect(extractSessionIdFromProductPath("uploads/note.md")).toBeNull();
    expect(
      inferAgentSlugFromDirectory("/ws/experts/quote-specialist/ses_1"),
    ).toBe("quote-specialist");
  });
});

describe("buildRootOutlineRows conversation nesting", () => {
  test("groups top-level loose files under orphan-header", () => {
    const children: WorkspaceFileTreeNode[] = [
      {
        name: "loose.xlsx",
        path: "loose.xlsx",
        kind: "file",
        size: 1,
        mtimeMs: 1,
        children: [],
      },
      {
        name: "1700000000000",
        path: "1700000000000",
        kind: "dir",
        size: 0,
        mtimeMs: 2,
        children: [
          {
            name: "a.md",
            path: "1700000000000/a.md",
            kind: "file",
            size: 2,
            mtimeMs: 2,
            children: [],
          },
        ],
      },
    ];
    const expanded = new Set<string>(["1700000000000", "__orphan_loose__"]);
    const rows = buildRootOutlineRows(children, expanded, {
      groupLooseAsOrphan: true,
      sessionTitleByKey: {
        "1700000000000": "优化AI方案介绍幻灯片效果",
      },
    });
    expect(rows.some((r) => r.type === "orphan-header")).toBe(true);
    expect(rows.some((r) => r.type === "loose-file")).toBe(true);
    const session = rows.find((r) => r.type === "task");
    expect(session?.type).toBe("task");
    if (session?.type === "task") {
      expect(session.displayTitle).toContain("优化");
    }
  });

  test("project → session → file nesting", () => {
    const children: WorkspaceFileTreeNode[] = [
      {
        name: "报价作业",
        path: "报价作业",
        kind: "dir",
        size: 0,
        mtimeMs: 1,
        children: [
          {
            name: "ses_a",
            path: "报价作业/ses_a",
            kind: "dir",
            size: 0,
            mtimeMs: 2,
            children: [
              {
                name: "quote.json",
                path: "报价作业/ses_a/quote.json",
                kind: "file",
                size: 3,
                mtimeMs: 3,
                children: [],
              },
            ],
          },
        ],
      },
    ];
    const expanded = new Set(["报价作业", "报价作业/ses_a"]);
    const rows = buildRootOutlineRows(children, expanded, {
      groupLooseAsOrphan: true,
      sessionTitleByKey: { ses_a: "报价需求整理会话" },
    });
    expect(rows[0]?.type).toBe("project");
    const task = rows.find((r) => r.type === "task");
    expect(task?.type).toBe("task");
    if (task?.type === "task") {
      expect(task.displayTitle).toBe("报价需求整理会话");
    }
    expect(rows.some((r) => r.type === "file")).toBe(true);
  });
});

describe("C5 expert archive + C1 delete copy contracts", () => {
  test("expert page archives with category expert and filters live list", () => {
    const expert = readApp("src/react-app/domains/session/pages/expert.tsx");
    expect(expert).toContain('category: "expert"');
    expect(expert).toContain("onArchiveSession={handleArchiveExpertSession}");
    expect(expert).toContain("archivedExpertSessionIds");
    expect(expert).toContain("deleteSessionOwnedWorkspaceFiles");
  });

  test("permanent-delete confirm copy states workspace files are removed", () => {
    const enSettings = readApp("src/i18n/locales/en/settings.ts");
    const zhSettings = readApp("src/i18n/locales/zh/settings.ts");
    const enSession = readApp("src/i18n/locales/en/session.ts");
    expect(enSettings).toMatch(/workspace files generated by that session/i);
    expect(zhSettings).toMatch(/工作区文件/);
    expect(enSession).toMatch(/workspace files generated by that task/i);
  });

  test("Mine uploads panel has drive toolbar without storage capacity UI", () => {
    const uploads = readApp(
      "src/react-app/domains/workspace/workspace-files-uploads-panel.tsx",
    );
    expect(uploads).toContain("files.import_to_workspace");
    expect(uploads).toContain("files.search_uploads_placeholder");
    expect(uploads).toContain("typeFilter");
    expect(uploads).not.toMatch(/storage.?quota|used.?limit|capacity/i);
    expect(uploads).not.toContain("files.storage");
  });
});
