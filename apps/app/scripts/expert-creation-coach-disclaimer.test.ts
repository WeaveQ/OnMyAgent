import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), "utf8");
}

describe("expert creation coach disclaimer", () => {
  test("does not render the removed footer disclaimer in either coach implementation", () => {
    const coachSources = [
      readWorkspaceFile(
        "apps/app/src/react-app/domains/session/pages/expert-creation-coach-surface.tsx",
      ),
      readWorkspaceFile(
        "apps/app/src/react-app/domains/agents/expert-creation-page.tsx",
      ),
    ];

    for (const source of coachSources) {
      expect(source).not.toContain("expert_creation_coach_disclaimer");
    }
  });
});
