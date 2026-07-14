import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("assistant navigation spacing contract", () => {
  test("keeps new-task and automation rows visually separated", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/components/shared-pages/agent-conversation-panel-header.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('data-assistant-primary-actions="true"');
    expect(source).toContain('className="grid gap-1"');
  });
});
