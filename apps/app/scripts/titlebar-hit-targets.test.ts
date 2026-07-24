import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

function readWorkspaceFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("Electron titlebar hit targets", () => {
  test("shared Button opts out of native window drag regions", () => {
    const source = readWorkspaceFile("apps/app/src/components/ui/button.tsx");

    expect(source).toContain("titlebar-no-drag");
  });

  test("session and side-panel top toolbars keep interactive controls out of drag regions", () => {
    // SessionSurface host delegates chrome; no-drag lives on header/layout shells.
    const requiredNoDragSources = [
      "apps/app/src/react-app/domains/session/surface/chrome/session-surface-header.tsx",
      "apps/app/src/react-app/domains/session/surface/session-surface-layout.tsx",
      "apps/app/src/react-app/domains/session/surface/code-scene-toolbar.tsx",
      "apps/app/src/react-app/domains/session/surface/code-workspace-side-panel.tsx",
      "apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx",
      "apps/app/src/react-app/domains/session/surface/chrome/empty-artifacts-panel.tsx",
      "apps/app/src/react-app/domains/session/chat/session-page-light-pages.tsx",
    ];

    for (const path of requiredNoDragSources) {
      expect(readWorkspaceFile(path), path).toContain("mac:titlebar-no-drag");
    }
  });

  test("local agent chrome keeps a drag region and opts interactive chips out", () => {
    const helpers = readWorkspaceFile(
      "apps/app/src/react-app/domains/local-agents/host/personal-local-agent-page-helpers.ts",
    );
    const page = readWorkspaceFile(
      "apps/app/src/react-app/domains/local-agents/host/personal-local-agent-page.tsx",
    );
    const statusRail = readWorkspaceFile(
      "apps/app/src/react-app/domains/local-agents/local-agent-status-rail.tsx",
    );

    expect(helpers).toContain("mac:titlebar-drag");
    expect(helpers).toContain("headerActions");
    expect(helpers).toContain("mac:titlebar-no-drag");
    // Whole header row must not be no-drag (would block window move).
    expect(page).not.toMatch(/headerRow[\s\S]{0,80}titlebar-no-drag/);
    expect(page).toContain("localAgentLayoutClass.headerActions");
    expect(statusRail).toContain("mac:titlebar-drag");
    expect(statusRail).toContain("mac:titlebar-no-drag");
  });
});

