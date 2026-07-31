import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

function readWorkspaceFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("assistant code icons", () => {
  test("code track icons and switch are fully removed", () => {
    const sidebarControls = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/sidebar/assistant-sidebar-controls.tsx",
    );
    const avatars = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/surface/chrome/avatars.tsx",
    );

    expect(sidebarControls).not.toContain("function AssistantCodeTabIcon");
    expect(sidebarControls).not.toContain('id: "code"');
    expect(avatars).not.toContain("function AssistantCodeDraftHomeIcon");
    expect(avatars).toContain("BookOpenCheck");
  });
});
