import { describe, expect, test } from "bun:test";

import {
  allKnowledgeFolderPaths,
  canDropKnowledgeItem,
  buildKnowledgeFolderTree,
  defaultKnowledgeNote,
  filterKnowledgeFiles,
  folderPathsContaining,
  GETTING_STARTED_REL_PATH,
  knowledgeHitKey,
  nextDuplicateRelPath,
  normalizeKnowledgeFolderName,
  rewriteFolderPrefix,
  normalizeNewNoteRelPath,
  noteKey,
  parseNoteKey,
  resolveKnowledgeExpertFolderId,
  suggestKnowledgeNoteName,
} from "../src/react-app/domains/session/knowledge/knowledge-vault-model";

describe("knowledge vault model", () => {
  test("opens getting-started first when present", () => {
    const selected = defaultKnowledgeNote([
      {
        scope: "user",
        path: "/vault",
        files: [
          { relPath: "later.md", name: "later.md", size: 1, mtimeMs: 1, indexable: true },
          {
            relPath: GETTING_STARTED_REL_PATH,
            name: GETTING_STARTED_REL_PATH,
            size: 1,
            mtimeMs: 1,
            indexable: true,
          },
        ],
      },
    ]);
    expect(selected).toEqual({ scope: "user", relPath: GETTING_STARTED_REL_PATH });
  });

  test("round-trips note keys and rejects traversal names", () => {
    expect(noteKey({ scope: "project", relPath: "a/b.md" })).toBe("project:a/b.md");
    expect(parseNoteKey("expert:playbook.md")).toEqual({
      scope: "expert",
      relPath: "playbook.md",
    });
    expect(normalizeNewNoteRelPath("../x")).toBeNull();
    expect(normalizeNewNoteRelPath("folder/note")).toBeNull();
    expect(normalizeNewNoteRelPath("Q3 brief")).toBe("Q3 brief.md");
    expect(normalizeNewNoteRelPath("q3-brief")).toBe("q3-brief.md");
  });

  test("filters by filename or search hits", () => {
    const files = [
      { relPath: "a.md", name: "a.md", size: 1, mtimeMs: 1, indexable: true },
      { relPath: "briefs/q3.md", name: "q3.md", size: 1, mtimeMs: 1, indexable: true },
    ];
    expect(filterKnowledgeFiles(files, "q3").map((file) => file.relPath)).toEqual([
      "briefs/q3.md",
    ]);
    expect(
      filterKnowledgeFiles(
        files,
        "campaign",
        new Set([knowledgeHitKey("user", "a.md")]),
        "user",
      ).map((file) => file.relPath),
    ).toEqual(["a.md"]);
    expect(
      filterKnowledgeFiles(
        files,
        "campaign",
        new Set([knowledgeHitKey("user", "a.md")]),
        "expert",
      ).map((file) => file.relPath),
    ).toEqual([]);
    expect(resolveKnowledgeExpertFolderId({
      draftAgentId: "ops-specialist",
      routeAgentId: "other-route-agent",
    })).toBe("ops-specialist");
    expect(resolveKnowledgeExpertFolderId({
      draftAgentId: null,
      routeAgentId: "route-only",
    })).toBe("route-only");
    expect(suggestKnowledgeNoteName(new Date("2026-08-15T09:05:00")).startsWith("note-20260815-")).toBe(
      true,
    );
  });

  test("builds a nested folder tree from relPaths", () => {
    const tree = buildKnowledgeFolderTree([
      { relPath: "root.md", name: "root.md", size: 1, mtimeMs: 1, indexable: true },
      { relPath: "briefs/q3.md", name: "q3.md", size: 1, mtimeMs: 1, indexable: true },
      { relPath: "briefs/deep/note.md", name: "note.md", size: 1, mtimeMs: 1, indexable: true },
    ]);
    expect(tree.map((node) => node.name)).toEqual(["briefs", "root.md"]);
    const briefs = tree[0];
    expect(briefs.kind).toBe("dir");
    if (briefs.kind !== "dir") return;
    expect(briefs.children.map((node) => node.name)).toEqual(["deep", "q3.md"]);
    expect(folderPathsContaining("briefs/deep/note.md")).toEqual(["briefs", "briefs/deep"]);
    expect(allKnowledgeFolderPaths([
      { relPath: "briefs/deep/note.md", name: "note.md", size: 1, mtimeMs: 1, indexable: true },
    ])).toEqual(["briefs", "briefs/deep"]);
    expect(normalizeKnowledgeFolderName("../x")).toBeNull();
    expect(normalizeKnowledgeFolderName("客户案例")).toBe("客户案例");
    expect(nextDuplicateRelPath("briefs/q3.md", new Set(["briefs/q3.md"]))).toBe(
      "briefs/q3-2.md",
    );
    expect(rewriteFolderPrefix("briefs/q3.md", "briefs", "archive")).toBe("archive/q3.md");
    expect(canDropKnowledgeItem({ kind: "file", path: "a.md" }, "briefs")).toBe(true);
    expect(canDropKnowledgeItem({ kind: "file", path: "briefs/a.md" }, "briefs")).toBe(false);
    expect(canDropKnowledgeItem({ kind: "dir", path: "briefs" }, "briefs/deep")).toBe(false);
  });
});

import {
  openKnowledgeNoteInRail,
  takePendingKnowledgeNote,
} from "../src/react-app/domains/session/knowledge/knowledge-vault-navigation";
import { knowledgePreviewBody } from "../src/react-app/domains/session/knowledge/knowledge-vault-preview-model";
import {
  isKnowledgeSearchToolName,
  parseKnowledgeSearchHits,
} from "../src/react-app/domains/session/knowledge/knowledge-search-hits";

describe("knowledge preview and search hits", () => {
  test("preview body strips frontmatter", () => {
    expect(
      knowledgePreviewBody("---\ntitle: Hello\n---\n# Body\n\nMore.\n"),
    ).toBe("# Body\n\nMore.\n");
    expect(knowledgePreviewBody("# Just body\n")).toBe("# Just body\n");
  });

  test("parses knowledge_search JSON and ignores garbage", () => {
    expect(isKnowledgeSearchToolName("knowledge_search")).toBe(true);
    expect(isKnowledgeSearchToolName("knowledge_read")).toBe(true);
    expect(isKnowledgeSearchToolName("bash")).toBe(false);
    const hits = parseKnowledgeSearchHits(
      JSON.stringify({
        ok: true,
        query: "brief",
        hits: [
          { scope: "project", relPath: "roadmap.md", title: "Roadmap" },
          { scope: "user", rel_path: "getting-started.md", title: "Getting started" },
          { relPath: "" },
        ],
      }),
    );
    expect(hits).toEqual([
      { scope: "project", relPath: "roadmap.md", title: "Roadmap" },
      { scope: "user", relPath: "getting-started.md", title: "Getting started" },
    ]);
    expect(parseKnowledgeSearchHits("not-json")).toEqual([]);
    expect(parseKnowledgeSearchHits(null)).toEqual([]);
    expect(
      parseKnowledgeSearchHits({
        ok: true,
        relPath: "meetings/standup.md",
        title: "Standup",
      }),
    ).toEqual([{ scope: "user", relPath: "meetings/standup.md", title: "Standup" }]);
  });

  test("pending knowledge note is consumed once", () => {
    openKnowledgeNoteInRail({ scope: "user", relPath: "roadmap.md" });
    expect(takePendingKnowledgeNote()).toEqual({
      scope: "user",
      relPath: "roadmap.md",
    });
    expect(takePendingKnowledgeNote()).toBeNull();
  });
});

