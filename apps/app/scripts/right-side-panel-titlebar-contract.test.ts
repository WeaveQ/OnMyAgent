import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

function readWorkspaceFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("right side panel titlebar contract", () => {
  test("expanded panel headers expose draggable space", () => {
    const paths = [
      "apps/app/src/react-app/domains/session/chat/session-page.tsx",
      "apps/app/src/react-app/domains/session/surface/code-workspace-side-panel.tsx",
      "apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx",
      "apps/app/src/react-app/domains/session/infinite-canvas/infinite-canvas-panel.tsx",
      "apps/app/src/react-app/domains/session/browser/browser-panel.tsx",
      "apps/app/src/react-app/domains/session/voice/voice-panel.tsx",
    ];

    for (const path of paths) {
      const source = readWorkspaceFile(path);
      expect(source, path).toContain('data-panel-titlebar="true"');
      expect(source, path).toContain("mac:titlebar-drag");
    }
  });

  test("interactive tab and navigation regions opt out of dragging", () => {
    const workspacePanel = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/code-workspace-side-panel.tsx",
    );
    const browserPanel = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/browser/browser-panel.tsx",
    );

    expect(workspacePanel).toContain('data-panel-titlebar-controls="true"');
    expect(workspacePanel).toContain("mac:titlebar-no-drag");
    expect(browserPanel).toContain('data-panel-titlebar-controls="true"');
    expect(browserPanel).toContain("mac:titlebar-no-drag");
  });
});
