import { describe, expect, test } from "bun:test";

import type { OnMyAgentWorkspaceFileCatalogEntry } from "../src/app/lib/onmyagent-server";
import {
  leftoverTaskCatalogEntries,
  prefixExpertRuntimeEntries,
  prefixExpertRuntimePath,
  stripExpertRuntimePath,
  workspaceDirectoryTargetsFromCatalog,
  workspaceMentionFlatBrowseTargets,
} from "../src/react-app/capabilities/artifacts/workspace-mention-targets";

function entry(
  path: string,
  kind: "file" | "dir" = "file",
): OnMyAgentWorkspaceFileCatalogEntry {
  return { path, kind, size: 10, mtimeMs: 1, revision: "" };
}

describe("workspace mention targets", () => {
  test("prefixes expert runtime paths under experts/", () => {
    expect(prefixExpertRuntimePath("kol-media-specialist/ses/a.docx")).toBe(
      "experts/kol-media-specialist/ses/a.docx",
    );
    expect(prefixExpertRuntimePath("experts/kol-media-specialist/a.docx")).toBe(
      "experts/kol-media-specialist/a.docx",
    );
    expect(stripExpertRuntimePath("experts/kol-media-specialist/ses/a.docx")).toBe(
      "kol-media-specialist/ses/a.docx",
    );
  });

  test("synthesizes expert agent folders from runtime file catalog", () => {
    const items = prefixExpertRuntimeEntries([
      entry("kol-content-ops-specialist/ses_a/brief.docx"),
      entry("kol-media-specialist/ses_b/plan.xlsx"),
      entry("kol-project-review-specialist/ses_c/notes.md"),
    ]);
    const roots = workspaceDirectoryTargetsFromCatalog(items, "experts");
    expect(roots.map((item) => item.path).sort()).toEqual([
      "experts/kol-content-ops-specialist",
      "experts/kol-media-specialist",
      "experts/kol-project-review-specialist",
    ]);
    expect(roots.every((item) => item.kind === "directory")).toBe(true);

    const sessions = workspaceDirectoryTargetsFromCatalog(
      items,
      "experts/kol-media-specialist",
    );
    expect(sessions).toEqual([
      expect.objectContaining({
        path: "experts/kol-media-specialist/ses_b",
        kind: "directory",
      }),
    ]);
  });

  test("empty @ flatten includes expert runtime files and leftover task files", () => {
    const targets = workspaceMentionFlatBrowseTargets([
      entry("uploads/photo.png"),
      entry("tasks"),
      entry("experts"),
      entry("notes.md"),
      ...prefixExpertRuntimeEntries([entry("kol-media-specialist/ses_b/plan.xlsx")]),
    ]);
    expect(targets.some((item) => item.path === "uploads/photo.png")).toBe(true);
    expect(targets.some((item) => item.path === "notes.md")).toBe(true);
    expect(
      targets.some(
        (item) => item.path === "experts/kol-media-specialist/ses_b/plan.xlsx",
      ),
    ).toBe(true);
    expect(targets.some((item) => item.path === "experts")).toBe(false);
  });

  test("leftover task entries keep root files outside product layout dirs", () => {
    const leftovers = leftoverTaskCatalogEntries([
      entry("tasks", "dir"),
      entry("experts", "dir"),
      entry("uploads", "dir"),
      entry("notes.md"),
      entry("scratch", "dir"),
      entry("tasks/ses_1/out.docx"),
    ]);
    expect(leftovers.map((item) => item.path).sort()).toEqual(["notes.md", "scratch"]);
  });
});
