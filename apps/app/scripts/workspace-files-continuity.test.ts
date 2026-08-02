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
  buildRootOutlineRows,
  buildUserUploadRelativePath,
  mapUploadsCatalogToRows,
  mergeMineUploadRows,
} from "../src/react-app/domains/workspace/workspace-files-model";
import { buildIsolatedExpertSessionDirectory } from "../src/react-app/capabilities/session-identity/expert-session-directory";
import {
  buildSessionTitleByKey,
  resolveOpenSourceSessionAction,
} from "../src/react-app/domains/workspace/workspace-files-open-session";
import {
  resolveUploadFolderRelativePath,
  sanitizeUploadFolderName,
} from "../src/react-app/domains/workspace/workspace-files-create-folder";

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
