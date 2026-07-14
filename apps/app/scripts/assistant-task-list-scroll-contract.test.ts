import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("assistant task list scroll contract", () => {
  test("keeps the task list controls fixed above scrolling rows", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/components/shared-pages/assistant-conversation-sections.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('data-assistant-task-list-header="true"');
    expect(source).toContain("sticky top-0 z-10");
  });

  test("keeps the task list disclosure action visually quiet", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/components/shared-pages/assistant-conversation-sections.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('data-assistant-task-list-disclosure="true"');
    expect(source).toContain(
      "bg-dls-surface-muted text-xs text-dls-secondary font-normal hover:bg-dls-hover hover:text-dls-text",
    );
  });
});
