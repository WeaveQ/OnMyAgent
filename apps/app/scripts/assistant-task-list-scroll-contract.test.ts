import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("assistant task list scroll contract", () => {
  test("previews twenty tasks before showing the disclosure action", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/sidebar/assistant-conversation-sections.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("const ASSISTANT_TASK_PREVIEW_LIMIT = 20;");
  });

  test("splits the list into three collapsible sections", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/sidebar/assistant-conversation-sections.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('data-assistant-section="tasks"');
    expect(source).toContain('data-assistant-section="spaces"');
    expect(source).toContain('data-assistant-section="automations"');
    expect(source).toContain('data-assistant-section-header="true"');
    expect(source).not.toContain("Popover");
    expect(source).not.toContain("activeFilter");
  });

  test("keeps the task list disclosure action visually quiet", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/sidebar/assistant-conversation-sections.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('data-assistant-task-list-disclosure="true"');
    expect(source).toContain(
      "bg-dls-sidebar text-xs font-normal text-dls-secondary hover:bg-dls-list-hover hover:text-dls-text",
    );
  });
});
