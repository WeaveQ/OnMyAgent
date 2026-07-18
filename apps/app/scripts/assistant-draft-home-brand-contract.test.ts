import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("assistant draft home brand contract", () => {
  test("uses a clean title + subtitle hero without watermark logo", () => {
    const chrome = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/session-surface-chrome.tsx",
      ),
      "utf8",
    );
    const surface = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/session-surface.tsx",
      ),
      "utf8",
    );
    const composer = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/composer.tsx",
      ),
      "utf8",
    );

    expect(chrome).toContain("export function SessionSurfaceDraftHome");
    expect(chrome).toContain("props.subtitle");
    expect(chrome).not.toContain("onmyagent-logo.png");
    expect(chrome).not.toContain("opacity-10");
    expect(chrome).toContain("AssistantDraftHomeMark");

    expect(surface).toContain("subtitle={assistantDraftHomeSubtitle}");
    expect(surface).toContain('t("session.assistant_work_subtitle")');
    expect(surface).toContain('t("session.assistant_code_subtitle")');

    // Workspace + permission full-width under composer; square joint (no top radii).
    expect(composer).toContain("bg-dls-surface-muted");
    expect(composer).toContain("bottomAccessory");
    expect(composer).toContain("rounded-t-none rounded-b-xl");
    expect(composer).toContain("rounded-t-xl rounded-b-none");
    expect(composer).not.toContain("bg-dls-surface-muted/40");
  });
});
