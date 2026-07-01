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
    const requiredNoDragSources = [
      "apps/app/src/react-app/domains/session/surface/session-surface.tsx",
      "apps/app/src/react-app/domains/session/surface/code-scene-toolbar.tsx",
      "apps/app/src/react-app/domains/session/surface/code-workspace-side-panel.tsx",
      "apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx",
      "apps/app/src/react-app/domains/session/components/shared-pages/empty-artifacts-panel.tsx",
      "apps/app/src/react-app/domains/session/chat/session-page-light-pages.tsx",
    ];

    for (const path of requiredNoDragSources) {
      expect(readWorkspaceFile(path), path).toContain("mac:titlebar-no-drag");
    }
  });
});
