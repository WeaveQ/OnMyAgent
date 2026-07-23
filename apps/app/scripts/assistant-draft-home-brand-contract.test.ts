import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const surfaceDir = join(
  import.meta.dir,
  "../src/react-app/domains/session/surface",
);

function readSurface(rel: string) {
  return readFileSync(join(surfaceDir, rel), "utf8");
}

function readSessionSurfaceSources() {
  return [
    readSurface("session-surface.tsx"),
    readSurface("session-surface-view.tsx"),
  ].join("\n");
}

describe("assistant draft home brand contract", () => {
  test("uses a clean title + subtitle hero without watermark logo", () => {
    const chromeBarrel = readSurface("session-surface-chrome.tsx");
    const draftHome = readSurface("chrome/session-surface-draft-home.tsx");
    const surface = readSessionSurfaceSources();
    const layoutMode = readSurface("session-surface-layout-mode.ts");
    const layout = readSurface("session-surface-layout.tsx");
    const composer = readSurface("composer/composer.tsx");

    expect(chromeBarrel).toContain("SessionSurfaceDraftHome");
    expect(draftHome).toContain("export function SessionSurfaceDraftHome");
    expect(draftHome).toContain("props.subtitle");
    expect(draftHome).not.toContain("onmyagent-logo.png");
    expect(draftHome).not.toContain("opacity-10");
    expect(draftHome).toContain("AssistantDraftHomeMark");

    expect(surface).toContain("export function SessionSurface");
    expect(surface).toMatch(
      /subtitle=\{(?:props\.)?assistantDraftHomeSubtitle\}/,
    );
    expect(layoutMode).toContain('t("session.assistant_work_subtitle")');
    expect(layoutMode).toContain('t("session.assistant_code_subtitle")');
    // Title stays max-w-2xl; composer width matches in-session (1120). Hero only grows height.
    expect(layout).toContain("max-w-2xl");
    expect(surface).toMatch(/homeLayout=\{(?:props\.)?homeComposerLayout\}/);
    expect(surface).toMatch(/heroHome=\{Boolean\(personalAssistantDraftHome\)\}/);
    expect(composer).toContain("const homeLayout = Boolean(props.homeLayout);");
    expect(composer).toContain("const heroHome = Boolean(props.heroHome);");
    expect(composer).toContain("max-w-[1120px]");
    expect(composer).toContain("rounded-2xl");
    const editor = readSurface("composer/editor.tsx");
    expect(editor).toContain("min-h-28");

    // Workspace + permission may still use under-card strip when not home-inline.
    expect(composer).toContain("bg-dls-surface-muted");
    expect(composer).toContain("bottomAccessory");
    expect(composer).toContain("rounded-t-none rounded-b-xl");
    expect(composer).toContain("rounded-t-xl rounded-b-none");
    expect(composer).not.toContain("bg-dls-surface-muted/40");
  });
});
