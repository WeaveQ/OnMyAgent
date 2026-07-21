/**
 * Structural contracts for session empty / draft / files / composer UX.
 * Drives real source files (not re-implemented rules) so regressions fail CI.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("session empty / draft / files / composer contracts", () => {
  test("assistant draft home hides SessionSurfaceHeader", () => {
    const src = read("src/react-app/domains/session/surface/session-surface.tsx");
    expect(src).toContain("personalAssistantDraftHome");
    expect(src).toMatch(/!personalAssistantDraftHome\s*\?\s*\(\s*\n\s*<SessionSurfaceHeader/);
  });

  test("composer homeLayout covers assistant + expert empty", () => {
    const src = read("src/react-app/domains/session/surface/session-surface.tsx");
    expect(src).toContain("homeComposerLayout");
    expect(src).toContain("expertEmptyComposer");
    expect(src).toContain("homeLayout={homeComposerLayout}");
    const editor = read("src/react-app/domains/session/surface/composer/editor.tsx");
    expect(editor).toMatch(/props\.compact[\s\S]*min-h-14/);
  });

  test("files panel is tree-first until a file is selected", () => {
    const src = read("src/react-app/domains/session/surface/workspace-files-panel.tsx");
    expect(src).toContain("const detailOpen = Boolean(selectedPath)");
    expect(src).toContain("if (!detailOpen)");
    expect(src).toContain("canPreviewOpenTargetInline");
  });

  test("plan mode chip has no hover X clear glyph", () => {
    const src = read("src/react-app/domains/session/surface/composer/composer.tsx");
    expect(src).toContain("shouldShowCollaborationChip");
    expect(src).not.toMatch(
      /shouldShowCollaborationChip[\s\S]{0,400}group-hover:hidden[\s\S]{0,200}<X /,
    );
  });

  test("skill matrix distinguishes loading from empty", () => {
    const src = read(
      "src/react-app/domains/local-agents/agent-management/agent-management-skill-matrix.tsx",
    );
    expect(src).toMatch(/loading[\s\S]{0,200}SkillMatrixSkeletonRows|SkillMatrixSkeletonRows[\s\S]{0,80}loading/);
    expect(src).toContain("matrix_loading");
  });

  test("session chrome has no text-[Npx] arbitrary font sizes", () => {
    const files = [
      "src/react-app/domains/session/surface/surface-styles.ts",
      "src/react-app/domains/session/surface/composer/notice.tsx",
      "src/react-app/domains/session/sidebar/agent-conversation-item.tsx",
      "src/react-app/domains/session/chat/session-page-session-archive-page.tsx",
    ];
    for (const file of files) {
      const src = read(file);
      expect(src).not.toMatch(/text-\[[0-9]+px\]/);
    }
  });

  test("composer tool menu is extracted from host", () => {
    const host = read("src/react-app/domains/session/surface/composer/composer.tsx");
    const menu = read("src/react-app/domains/session/surface/composer/composer-tool-menu.tsx");
    expect(host).toContain("ComposerToolMenu");
    expect(menu).toContain("export function ComposerToolMenu");
    // Host stays under the pre-extract bulk (was ~2155 lines).
    expect(host.split("\n").length).toBeLessThan(1800);
  });

  test("session-surface transcript and composer columns use layout shells", () => {
    const host = read("src/react-app/domains/session/surface/session-surface.tsx");
    const layout = read("src/react-app/domains/session/surface/session-surface-layout.tsx");
    expect(layout).toContain("export function SessionSurfaceTranscriptPane");
    expect(layout).toContain("export function SessionSurfaceComposerColumn");
    expect(layout).toContain("export function SessionSurfaceBody");
    expect(host).toContain("SessionSurfaceTranscriptPane");
    expect(host).toContain("SessionSurfaceComposerColumn");
    expect(host).toContain("SessionSurfaceBody");
  });
});
