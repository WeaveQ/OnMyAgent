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
    ];

    for (const path of paths) {
      const source = readWorkspaceFile(path);
      expect(source, path).toContain('data-panel-titlebar="true"');
      expect(source, path).toContain("mac:titlebar-drag");
    }
  });

  test("tab strip containers stay drag-able; only interactive chrome opts out", () => {
    const workspacePanel = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/code-workspace-side-panel.tsx",
    );
    const browserPanel = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/browser/browser-panel.tsx",
    );

    expect(workspacePanel).toContain('data-panel-titlebar-controls="true"');
    expect(browserPanel).toContain('data-panel-titlebar-controls="true"');
    // Blank header chrome must remain a window-drag region. A blanket
    // titlebar-no-drag on the flex-1 scroller blocks the whole top bar.
    expect(workspacePanel).not.toMatch(
      /data-panel-titlebar-controls="true"\s*\n\s*className="[^"]*titlebar-no-drag/,
    );
    expect(browserPanel).not.toMatch(
      /data-panel-titlebar-controls="true"\s*\n\s*className="[^"]*titlebar-no-drag/,
    );
    // URL field (and similar inputs) still opt out so typing is not a window drag.
    expect(browserPanel).toContain("mac:titlebar-no-drag");
  });
});
