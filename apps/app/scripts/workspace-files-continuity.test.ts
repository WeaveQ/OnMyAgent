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
  toProductLayoutRelativePath,
} from "../src/react-app/domains/workspace/workspace-files-layout";
import {
  deleteSessionOwnedWorkspaceFiles,
  inferAgentSlugFromDirectory,
  resolveSessionOwnedFilePaths,
} from "../src/react-app/domains/workspace/workspace-files-session-cleanup";
import {
  FILES_UNGROUPED_PATH,
  WORKSPACE_INBOX_DIR,
  buildTreeNodesFromUploadRows,
  buildTreeOutlineRows,
  buildUngroupedFolderNode,
  buildUserUploadRelativePath,
  collectExpandableDirPaths,
  isDirectChildOfPrefix,
  isFilesUngroupedPath,
  mapUploadsCatalogToRows,
  mergeMineUploadRows,
  workspaceRelativeForUploadRow,
} from "../src/react-app/domains/workspace/workspace-files-model";
import { buildIsolatedExpertSessionDirectory } from "../src/react-app/capabilities/session-identity/expert-session-directory";
import {
  buildSessionTitleByKey,
  resolveOpenSourceSessionAction,
} from "../src/react-app/domains/workspace/workspace-files-open-session";
import {
  resolveMineMoveDestination,
  resolveUploadFolderRelativePath,
  sanitizeUploadFolderName,
} from "../src/react-app/domains/workspace/workspace-files-create-folder";
import {
  mapInboxRelativeToUploadsPath,
  planInboxToUploadsMigration,
  displayMinePathUnderUploads,
} from "../src/react-app/domains/workspace/workspace-files-mine-migrate";

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

  test("absolute expert directory without workspaceRoot still resolves experts root", () => {
    const abs =
      "/Users/work/Library/Application Support/OnMyAgent/ws/experts/报价作业-quote-specialist/1785029883722";
    expect(toProductLayoutRelativePath(abs)).toBe(
      "experts/报价作业-quote-specialist/1785029883722",
    );
    const roots = candidateSessionOwnedRoots({
      sessionId: "ses_real",
      directory: abs,
      // no workspaceRoot, no agentSlug — must still peel experts/...
    });
    expect(roots).toContain(
      "experts/报价作业-quote-specialist/1785029883722",
    );
    // Agent inferred from directory so experts/{slug}/{sessionId} is also a candidate
    expect(roots).toContain(
      "experts/报价作业-quote-specialist/ses_real",
    );
    // Never return absolute leftovers
    expect(roots.every((r) => !r.startsWith("/"))).toBe(true);
    expect(roots.every((r) => isUnderProductLayoutRoot(r))).toBe(true);
  });

  test("absolute directory with workspaceRoot strips prefix", () => {
    const ws = "/Users/work/ws-root";
    const abs = `${ws}/experts/fleet/ses_9`;
    expect(toProductLayoutRelativePath(abs, ws)).toBe("experts/fleet/ses_9");
    const roots = candidateSessionOwnedRoots({
      sessionId: "ses_9",
      directory: abs,
      workspaceRoot: ws,
      agentSlug: "fleet",
    });
    expect(roots).toContain("experts/fleet/ses_9");
    expect(roots).toContain("tasks/ses_9");
  });

  test("absolute path without layout marker fails closed (no fake root)", () => {
    expect(
      toProductLayoutRelativePath("/tmp/random-session-dir"),
    ).toBeNull();
    const roots = candidateSessionOwnedRoots({
      sessionId: "ses_x",
      directory: "/tmp/random-session-dir",
    });
    // Still has tasks/{id} fallback; must NOT include /tmp/...
    expect(roots).toContain("tasks/ses_x");
    expect(roots.some((r) => r.includes("tmp") || r.startsWith("/"))).toBe(
      false,
    );
  });

  test("deleteSessionOwnedWorkspaceFiles unlinks resolved expert absolute root via mock client", async () => {
    const deleted: string[] = [];
    const abs =
      "/Users/me/workspace/experts/quote-specialist/ses_1";
    const client = {
      listWorkspaceFiles: async () => ({ items: [] as Array<{ path: string }> }),
      deleteWorkspaceFile: async (_wid: string, path: string) => {
        deleted.push(path);
      },
    };
    const result = await deleteSessionOwnedWorkspaceFiles({
      client,
      workspaceId: "ws_1",
      sessionId: "ses_1",
      directory: abs,
      // no workspaceRoot — path must still peel to experts/...
    });
    expect(result.roots).toContain("experts/quote-specialist/ses_1");
    expect(deleted).toContain("experts/quote-specialist/ses_1");
    expect(deleted.every((p) => !p.startsWith("/"))).toBe(true);
  });

  test("production write entry points force layout roots (AC5)", () => {
    const upload = buildUserUploadRelativePath("report.xlsx");
    expect(upload).toBe(
      resolveProductWriteRelativePath({
        source: "user_upload",
        fileName: "report.xlsx",
      }),
    );
    expect(upload.startsWith(`${WORKSPACE_UPLOADS_DIR}/`)).toBe(true);
    expect(isBareWorkspaceRootFile(upload)).toBe(false);

    const isolated = buildIsolatedExpertSessionDirectory({
      workspaceRoot: "/ws",
      agentName: "报价作业",
      agentId: "quote-specialist",
      sessionKey: "ses_key",
    });
    const expectedMarker = resolveProductWriteRelativePath({
      source: "expert",
      fileName: "onmyagent-session.json",
      sessionId: "ses_key",
      agentSlug: isolated.agentSegment,
    });
    expect(isolated.markerRelativePath).toBe(expectedMarker);
    expect(isolated.markerRelativePath.startsWith(`${WORKSPACE_EXPERTS_DIR}/`)).toBe(
      true,
    );
  });
});

describe("files tree outline helpers", () => {
  test("isDirectChildOfPrefix detects one-level children only", () => {
    expect(isDirectChildOfPrefix("uploads/a.md", "uploads")).toBe(true);
    expect(isDirectChildOfPrefix("uploads/docs/a.md", "uploads")).toBe(false);
    expect(isDirectChildOfPrefix("uploads", "uploads")).toBe(false);
    expect(isDirectChildOfPrefix("uploads/docs/nested", "uploads/docs")).toBe(
      true,
    );
  });

  test("buildTreeNodesFromUploadRows nests descendants under parent", () => {
    const roots = buildTreeNodesFromUploadRows(
      [
        {
          id: "1",
          name: "docs",
          path: "uploads/docs",
          size: 0,
          updatedAt: 2,
          kind: "dir",
        },
        {
          id: "2",
          name: "a.md",
          path: "uploads/docs/a.md",
          size: 1,
          updatedAt: 3,
          kind: "file",
        },
        {
          id: "3",
          name: "nested",
          path: "uploads/docs/nested",
          size: 0,
          updatedAt: 1,
          kind: "dir",
        },
        {
          id: "4",
          name: "b.md",
          path: "uploads/docs/nested/b.md",
          size: 2,
          updatedAt: 4,
          kind: "file",
        },
      ],
      "uploads",
    );
    expect(roots.map((r) => r.name)).toEqual(["docs"]);
    const docs = roots[0]!;
    expect(docs.children.map((c) => c.name).sort()).toEqual(["a.md", "nested"]);
    const nested = docs.children.find((c) => c.name === "nested");
    expect(nested?.children.map((c) => c.name)).toEqual(["b.md"]);
  });

  test("buildUngroupedFolderNode wraps root loose files", () => {
    const node = buildUngroupedFolderNode(
      [
        {
          name: "loose.xlsx",
          path: "loose.xlsx",
          kind: "file",
          size: 1,
          mtimeMs: 9,
          children: [],
        },
        {
          name: "skip-dir",
          path: "skip-dir",
          kind: "dir",
          size: 0,
          mtimeMs: 1,
          children: [],
        },
      ],
      "未分组",
    );
    expect(node.path).toBe(FILES_UNGROUPED_PATH);
    expect(isFilesUngroupedPath(node.path)).toBe(true);
    expect(node.kind).toBe("dir");
    expect(node.name).toBe("未分组");
    expect(node.children.map((c) => c.name)).toEqual(["loose.xlsx"]);
    expect(node.mtimeMs).toBe(9);
  });

  test("buildTreeOutlineRows keeps parent/child depth", () => {
    const roots: WorkspaceFileTreeNode[] = [
      {
        name: "proj",
        path: "proj",
        kind: "dir",
        size: 0,
        mtimeMs: 1,
        children: [
          {
            name: "task",
            path: "proj/task",
            kind: "dir",
            size: 0,
            mtimeMs: 2,
            children: [
              {
                name: "a.md",
                path: "proj/task/a.md",
                kind: "file",
                size: 1,
                mtimeMs: 3,
                children: [],
              },
            ],
          },
        ],
      },
    ];
    const collapsed = buildTreeOutlineRows(roots, new Set());
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.type).toBe("dir");
    if (collapsed[0]?.type === "dir") {
      expect(collapsed[0].depth).toBe(0);
      expect(collapsed[0].expanded).toBe(false);
    }
    const expanded = buildTreeOutlineRows(
      roots,
      new Set(["proj", "proj/task"]),
    );
    expect(expanded.map((r) => [r.type, r.depth, r.node.name])).toEqual([
      ["dir", 0, "proj"],
      ["dir", 1, "task"],
      ["file", 2, "a.md"],
    ]);
    expect(collectExpandableDirPaths(roots).sort()).toEqual([
      "proj",
      "proj/task",
    ]);
  });

  test("tree outline groups session titles and loose files at root", () => {
    const ungrouped = buildUngroupedFolderNode(
      [
        {
          name: "loose.xlsx",
          path: "loose.xlsx",
          kind: "file",
          size: 1,
          mtimeMs: 1,
          children: [],
        },
      ],
      "Ungrouped",
    );
    const sessionDir: WorkspaceFileTreeNode = {
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
    };
    const roots = [sessionDir, ungrouped];
    const rows = buildTreeOutlineRows(
      roots,
      new Set(["1700000000000", FILES_UNGROUPED_PATH]),
      {
        sessionTitleByKey: {
          "1700000000000": "Optimize AI slides",
        },
      },
    );
    const session = rows.find(
      (r) => r.type === "dir" && r.node.path === "1700000000000",
    );
    expect(session?.type).toBe("dir");
    if (session?.type === "dir") {
      expect(session.displayTitle).toContain("Optimize");
      expect(session.depth).toBe(0);
    }
    expect(
      rows.some((r) => r.type === "file" && r.node.name === "a.md"),
    ).toBe(true);
    expect(
      rows.some(
        (r) => r.type === "dir" && r.node.path === FILES_UNGROUPED_PATH,
      ),
    ).toBe(true);
    expect(
      rows.some((r) => r.type === "file" && r.node.name === "loose.xlsx"),
    ).toBe(true);
  });

  test("project → session → file nesting via tree outline", () => {
    const children: WorkspaceFileTreeNode[] = [
      {
        name: "quote-job",
        path: "quote-job",
        kind: "dir",
        size: 0,
        mtimeMs: 1,
        children: [
          {
            name: "ses_a",
            path: "quote-job/ses_a",
            kind: "dir",
            size: 0,
            mtimeMs: 2,
            children: [
              {
                name: "quote.json",
                path: "quote-job/ses_a/quote.json",
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
    const expanded = new Set(["quote-job", "quote-job/ses_a"]);
    const rows = buildTreeOutlineRows(children, expanded, {
      sessionTitleByKey: { ses_a: "Quote requirements session" },
    });
    expect(rows[0]?.type).toBe("dir");
    const session = rows.find(
      (r) => r.type === "dir" && r.node.path === "quote-job/ses_a",
    );
    expect(session?.type).toBe("dir");
    if (session?.type === "dir") {
      expect(session.displayTitle).toBe("Quote requirements session");
      expect(session.depth).toBe(1);
    }
    expect(rows.some((r) => r.type === "file")).toBe(true);
  });
});

describe("open source session + create folder (Sprint A/B)", () => {
  test("resolveOpenSourceSessionAction active / archived / missing / none", () => {
    const active = resolveOpenSourceSessionAction({
      relativePath: "tasks/ses_live/out.xlsx",
      activeSessionIds: ["ses_live"],
      archivedSessionIds: [],
    });
    expect(active).toEqual({
      sessionId: "ses_live",
      status: "active",
      canOpen: true,
    });

    const archived = resolveOpenSourceSessionAction({
      relativePath: "experts/fleet/ses_arch/a.json",
      activeSessionIds: [],
      archivedSessionIds: new Set(["ses_arch"]),
    });
    expect(archived.status).toBe("archived");
    expect(archived.canOpen).toBe(true);

    const missing = resolveOpenSourceSessionAction({
      relativePath: "tasks/ses_gone/x.md",
      activeSessionIds: [],
      archivedSessionIds: [],
    });
    expect(missing.status).toBe("missing");
    expect(missing.canOpen).toBe(false);

    const none = resolveOpenSourceSessionAction({
      relativePath: "uploads/note.md",
      activeSessionIds: ["ses_live"],
    });
    expect(none.status).toBe("none");
    expect(none.canOpen).toBe(false);
  });

  test("buildSessionTitleByKey prefers live over archive", () => {
    const map = buildSessionTitleByKey({
      liveSessions: [{ id: "s1", title: "Live title" }],
      archivedTasks: [
        { sessionId: "s1", title: "Archived title" },
        { sessionId: "s2", title: "Only archived" },
      ],
    });
    expect(map.s1).toBe("Live title");
    expect(map.s2).toBe("Only archived");
  });

  test("workspaceRelativeForUploadRow distinguishes inbox vs workspace roots", () => {
    expect(
      workspaceRelativeForUploadRow({
        path: "uploads/lark-auth-qr.png",
        source: "workspace",
      }),
    ).toBe("uploads/lark-auth-qr.png");
    expect(
      workspaceRelativeForUploadRow({
        path: "uploads/lark-auth-qr.png",
        source: "inbox",
      }),
    ).toBe(`${WORKSPACE_INBOX_DIR}/uploads/lark-auth-qr.png`);
    expect(
      workspaceRelativeForUploadRow({
        path: "note.md",
        source: "inbox",
      }),
    ).toBe(`${WORKSPACE_INBOX_DIR}/note.md`);
  });

  test("create folder path stays under uploads/", () => {
    expect(sanitizeUploadFolderName("  报价 资料  ")).toBeTruthy();
    const path = resolveUploadFolderRelativePath("报价资料");
    expect(path).toBe(`${WORKSPACE_UPLOADS_DIR}/报价资料`);
    expect(isUnderProductLayoutRoot(path!)).toBe(true);
    expect(resolveUploadFolderRelativePath("")).toBeNull();
    expect(resolveUploadFolderRelativePath("..")).toBeNull();
    expect(
      resolveUploadFolderRelativePath("sub", `${WORKSPACE_UPLOADS_DIR}/parent`),
    ).toBe(`${WORKSPACE_UPLOADS_DIR}/parent/sub`);
  });

  test("inbox → uploads migration maps product paths", () => {
    expect(mapInboxRelativeToUploadsPath("uploads/a.xlsx")).toBe(
      "uploads/a.xlsx",
    );
    expect(mapInboxRelativeToUploadsPath("a.xlsx")).toBe("uploads/a.xlsx");
    expect(mapInboxRelativeToUploadsPath("session-uploads/x.png")).toBe(
      "uploads/x.png",
    );
    expect(mapInboxRelativeToUploadsPath(".DS_Store")).toBeNull();
    const plan = planInboxToUploadsMigration([
      "uploads/note.md",
      "old.pdf",
      ".DS_Store",
    ]);
    expect(plan.map((p) => p.to).sort()).toEqual(
      ["uploads/note.md", "uploads/old.pdf"].sort(),
    );
    expect(plan[0]?.from.startsWith(".opencode/onmyagent/inbox/")).toBe(true);
    expect(
      displayMinePathUnderUploads(
        ".opencode/onmyagent/inbox/uploads/secret.png",
      ),
    ).toBe("uploads/secret.png");
  });

  test("resolveMineMoveDestination moves into folder under uploads/", () => {
    const move = resolveMineMoveDestination({
      sourceWorkspaceRelativePath: "uploads/lark-auth-qr.png",
      targetFolderWorkspaceRelativePath: "uploads/文档",
    });
    expect(move).toEqual({
      from: "uploads/lark-auth-qr.png",
      to: "uploads/文档/lark-auth-qr.png",
    });
    // Already in target → null
    expect(
      resolveMineMoveDestination({
        sourceWorkspaceRelativePath: "uploads/文档/a.xlsx",
        targetFolderWorkspaceRelativePath: "uploads/文档",
      }),
    ).toBeNull();
    // Cannot move folder into itself
    expect(
      resolveMineMoveDestination({
        sourceWorkspaceRelativePath: "uploads/文档",
        targetFolderWorkspaceRelativePath: "uploads/文档",
      }),
    ).toBeNull();
    // Inbox source into workspace folder is allowed (path still renames on disk)
    expect(
      resolveMineMoveDestination({
        sourceWorkspaceRelativePath:
          ".opencode/onmyagent/inbox/uploads/应收台账模板.xlsx",
        targetFolderWorkspaceRelativePath: "uploads/文档",
      }),
    ).toEqual({
      from: ".opencode/onmyagent/inbox/uploads/应收台账模板.xlsx",
      to: "uploads/文档/应收台账模板.xlsx",
    });
  });

  test("uploads catalog maps dirs and merges with inbox", () => {
    const catalog = mapUploadsCatalogToRows(
      [
        {
          path: "uploads/reports",
          kind: "dir",
          mtimeMs: 10,
        },
        {
          path: "uploads/reports/nested.xlsx",
          kind: "file",
          size: 3,
          mtimeMs: 11,
        },
        { path: "uploads/a.md", kind: "file", size: 1, mtimeMs: 5 },
        { path: "uploads/.DS_Store", kind: "file", size: 6, mtimeMs: 9 },
      ],
      { parentPrefix: "uploads", shallow: true },
    );
    expect(catalog.some((r) => r.kind === "dir" && r.name === "reports")).toBe(
      true,
    );
    expect(catalog.some((r) => r.path === "uploads/a.md")).toBe(true);
    // nested file hidden at shallow root
    expect(catalog.some((r) => r.path.includes("nested"))).toBe(false);
    // Finder junk never surfaces in Mine catalog rows
    expect(catalog.some((r) => r.name === ".DS_Store")).toBe(false);

    const merged = mergeMineUploadRows(
      [
        {
          id: "inbox1",
          name: "old.md",
          path: "uploads/a.md",
          size: 9,
          updatedAt: 1,
          kind: "file",
        },
        {
          id: "junk",
          name: ".DS_Store",
          path: "uploads/.DS_Store",
          size: 6,
          updatedAt: 2,
          kind: "file",
        },
      ],
      catalog,
    );
    // catalog wins same path
    expect(merged.find((r) => r.path === "uploads/a.md")?.size).toBe(1);
    expect(merged.some((r) => r.kind === "dir")).toBe(true);
    expect(merged.some((r) => r.name === ".DS_Store")).toBe(false);
  });

  test("uploads catalog nested folder never lists root siblings", () => {
    // Regression: entering uploads/test21 must not show uploads-root files
    // (old shallow path rewrote siblings into the current folder).
    const nested = mapUploadsCatalogToRows(
      [
        { path: "uploads/test21", kind: "dir", mtimeMs: 20 },
        { path: "uploads/test21/文档", kind: "dir", mtimeMs: 19 },
        {
          path: "uploads/test21/only-inside.md",
          kind: "file",
          size: 2,
          mtimeMs: 18,
        },
        {
          path: "uploads/Agent快速上手分享.zip",
          kind: "file",
          size: 9,
          mtimeMs: 17,
        },
        { path: "uploads/larkauth-qr.png", kind: "file", size: 4, mtimeMs: 16 },
        {
          path: "uploads/other/folder/deep.txt",
          kind: "file",
          size: 1,
          mtimeMs: 15,
        },
      ],
      { parentPrefix: "uploads/test21", shallow: true },
    );
    expect(nested.map((r) => r.path).sort()).toEqual([
      "uploads/test21/only-inside.md",
      "uploads/test21/文档",
    ]);
    expect(nested.some((r) => r.name.includes("Agent"))).toBe(false);
    expect(nested.some((r) => r.name.includes("larkauth"))).toBe(false);

    const deep = mapUploadsCatalogToRows(
      [
        { path: "uploads/test21/文档", kind: "dir", mtimeMs: 19 },
        {
          path: "uploads/test21/文档/note.md",
          kind: "file",
          size: 1,
          mtimeMs: 18,
        },
        { path: "uploads/root.md", kind: "file", size: 1, mtimeMs: 5 },
      ],
      { parentPrefix: "uploads/test21", shallow: false },
    );
    expect(deep.map((r) => r.path).sort()).toEqual([
      "uploads/test21/文档",
      "uploads/test21/文档/note.md",
    ]);
    expect(deep.some((r) => r.path === "uploads/root.md")).toBe(false);
  });

  test("browser and hosts wire open-source-session + create folder", () => {
    const browser = readApp(
      "src/react-app/domains/workspace/workspace-files-browser-panel.tsx",
    );
    const uploads = readApp(
      "src/react-app/domains/workspace/workspace-files-uploads-panel.tsx",
    );
    const page = readApp(
      "src/react-app/domains/workspace/workspace-files-page.tsx",
    );
    const assistant = readApp(
      "src/react-app/domains/session/pages/assistant.tsx",
    );
    expect(browser).toContain("data-files-open-source-session");
    expect(browser).toContain("onOpenSourceSession");
    expect(browser).toContain("sessionTitleByKey");
    expect(uploads).toContain("data-files-create-folder");
    expect(uploads).toContain("mkdirWorkspaceDirectory");
    expect(uploads).toContain("mapUploadsCatalogToRows");
    expect(uploads).toContain("renameWorkspaceFile");
    expect(uploads).toContain("writeWorkspaceBinaryFile");
    expect(uploads).toContain("planInboxToUploadsMigration");
    expect(uploads).toContain("application/x-onmyagent-mine-file");
    expect(uploads).toContain("handleFolderDrop");
    expect(uploads).toContain("files.move_to_success");
    expect(uploads).toContain("files.move_view");
    expect(uploads).toContain("files.move_to");
    expect(uploads).toContain("data-files-move-to");
    expect(uploads).toContain("MineMoveToDialog");
    expect(uploads).toContain("actionLabel");
    expect(page).toContain("onOpenSourceSession");
    expect(assistant).toContain("onOpenSourceSession");
    expect(assistant).toContain("filesOpenSessionMeta");
  });
});

describe("C5 expert archive + C1 delete copy contracts", () => {
  test("expert page archives with category expert and filters live list", () => {
    const expert = readApp("src/react-app/domains/session/pages/expert.tsx");
    expect(expert).toContain('category: "expert"');
    expect(expert).toContain("onArchiveSession={handleArchiveExpertSession}");
    expect(expert).toContain("archivedExpertSessionIds");
    expect(expert).toContain("deleteSessionOwnedWorkspaceFiles");
    expect(expert).toContain("workspaceRoot: props.selectedWorkspaceRoot");
    expect(expert).toContain("activeConversationAgentId");
  });

  test("assistant and settings permanent-delete pass workspaceRoot", () => {
    const assistant = readApp(
      "src/react-app/domains/session/pages/assistant.tsx",
    );
    const settings = readApp(
      "src/react-app/domains/settings/pages/archived-tasks-view.tsx",
    );
    const settingsHost = readApp(
      "src/react-app/shell/settings-route/settings-tab-body.tsx",
    );
    expect(assistant).toContain("workspaceRoot: props.selectedWorkspaceRoot");
    expect(settings).toContain("workspaceRoot: props.workspaceRoot");
    expect(settingsHost).toContain("workspaceRoot={ctx.selectedWorkspaceRoot}");
  });

  test("permanent-delete confirm copy states workspace files are removed", () => {
    const enSettings = readApp("src/i18n/locales/en/settings.ts");
    const zhSettings = readApp("src/i18n/locales/zh/settings.ts");
    const enSession = readApp("src/i18n/locales/en/session.ts");
    expect(enSettings).toMatch(/workspace files generated by that session/i);
    expect(zhSettings).toMatch(/工作区文件/);
    expect(enSession).toMatch(/workspace files generated by that task/i);
  });

  test("Mine uploads panel has Hope-style toolbar without storage capacity UI", () => {
    const uploads = readApp(
      "src/react-app/domains/workspace/workspace-files-uploads-panel.tsx",
    );
    // Primary actions toolbar + path bar (breadcrumb · expand · type · search · refresh).
    expect(uploads).toContain('data-files-mine-toolbar="true"');
    expect(uploads).toContain('data-files-mine-pathbar="true"');
    expect(uploads).toContain('data-files-create-folder="true"');
    expect(uploads).toContain('data-files-upload="true"');
    expect(uploads).toContain('data-files-mine-breadcrumb="true"');
    expect(uploads).toContain('data-files-mine-refresh="true"');
    expect(uploads).toContain('data-files-expand-collapse="true"');
    expect(uploads).toContain("data-files-tree-mode");
    expect(uploads).toContain("buildTreeNodesFromUploadRows");
    expect(uploads).toContain("buildTreeOutlineRows");
    expect(uploads).toContain("files.upload_files");
    expect(uploads).toContain("files.expand_all_folders");
    expect(uploads).toContain("files.collapse_all_folders");
    expect(uploads).toContain("files.column_type");
    expect(uploads).toContain("files.search_uploads_placeholder");
    expect(uploads).toContain("typeFilter");
    // A7: no storage used/limit UI (comment text may mention capacity; ban product keys/UI).
    expect(uploads).not.toMatch(/存储空间|storage.?used|used.?limit|files\.storage/i);
    expect(uploads).not.toContain("升级");
  });

  test("Tasks/Experts browser chrome matches Mine pathbar layout", () => {
    const browser = readApp(
      "src/react-app/domains/workspace/workspace-files-browser-panel.tsx",
    );
    // Pathbar: breadcrumb · expand · type · search · refresh (no empty toolbar).
    expect(browser).not.toContain('data-files-browser-toolbar="true"');
    expect(browser).toContain('data-files-browser-pathbar="true"');
    expect(browser).not.toContain('data-files-browser-breadcrumb="true"');
    expect(browser).toContain('data-files-browser-refresh="true"');
    expect(browser).toContain('data-files-expand-collapse="true"');
    // Breadcrumb root uses product tab title, not generic workspace label.
    expect(browser).toContain("filesSourceTabTitleKey(sourceTab)");
    expect(browser).toContain("ChevronsUpDown");
    expect(browser).toContain("ChevronsDownUp");
    expect(browser).toContain("files.expand_all_folders");
    expect(browser).toContain("files.collapse_all_folders");
    expect(browser).toContain("typeFilter");
    expect(browser).toContain("rounded-full");
    expect(browser).toContain("files.search_placeholder");
    // Conversation outline: expand/collapse in place; session title opens chat.
    expect(browser).toContain("buildTreeOutlineRows");
    expect(browser).toContain("data-files-tree-depth");
    expect(browser).toContain("data-files-session-title");
    expect(browser).toContain("openSessionForPath");
    expect(browser).toContain("onOpenSourceSession");
    expect(browser).not.toContain("enterDirectory");
    expect(browser).not.toContain("buildRootOutlineRows");
    // Root loose files still surface as ungrouped group.
    expect(browser).toContain("buildUngroupedFolderNode");
    expect(browser).toContain("files.ungrouped");
    expect(browser).toContain('data-files-ungrouped');
    expect(browser).toContain("WORKSPACE_FILES_CATALOG_LIMIT");
    expect(browser).toContain("data-files-catalog-truncated");
  });
});

describe("files module structure", () => {
  test("model barrel re-exports focused modules; chrome helpers exist", () => {
    const model = readApp(
      "src/react-app/domains/workspace/workspace-files-model.ts",
    );
    const chrome = readApp(
      "src/react-app/domains/workspace/workspace-files-chrome.tsx",
    );
    const page = readApp(
      "src/react-app/domains/workspace/workspace-files-page.tsx",
    );
    expect(model).toContain('export * from "./workspace-files-categories"');
    expect(model).toContain('export * from "./workspace-files-tree-outline"');
    expect(model).toContain('export * from "./workspace-files-source-tabs"');
    expect(model).toContain('export * from "./workspace-files-uploads-catalog"');
    expect(model).not.toContain("buildRootOutlineRows");
    expect(chrome).toContain("useFilesRefreshFlash");
    expect(chrome).toContain("FilesTypeFilter");
    expect(chrome).toContain("FilesRefreshButton");
    expect(page).toContain("readFilesTabFromUrl");
    expect(page).toContain("writeFilesTabToUrl");
    expect(page).toContain('searchParams.set("tab"');
  });
});
