import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const sectionsSource = readFileSync(
  join(
    repoRoot,
    "apps/app/src/react-app/domains/session/sidebar/assistant-conversation-sections.tsx",
  ),
  "utf8",
);
const listModelSource = readFileSync(
  join(
    repoRoot,
    "apps/app/src/react-app/domains/session/sidebar/assistant-list-model.ts",
  ),
  "utf8",
);

describe("assistant task list scroll contract", () => {
  test("previews recent tasks before showing the disclosure action", () => {
    expect(sectionsSource).toContain("const RECENT_PREVIEW_LIMIT = 12;");
  });

  test("splits the list into collapsible sections without a separate 任务 block", () => {
    expect(sectionsSource).toContain('data-assistant-section="pinned"');
    expect(sectionsSource).toContain('data-assistant-section="recent"');
    expect(sectionsSource).toContain('data-assistant-section="spaces"');
    expect(sectionsSource).toContain('data-assistant-section="automations"');
    expect(sectionsSource).toContain('data-assistant-section-header="true"');
    // Pin / space / recent rules live in the pure list model — not re-split as 任务.
    expect(sectionsSource).not.toContain('data-assistant-section="tasks"');
    expect(listModelSource).toContain("export function buildAssistantListModel");
    expect(sectionsSource).not.toContain("Popover");
    expect(sectionsSource).not.toContain("activeFilter");
  });

  test("keeps the task list disclosure action visually quiet", () => {
    expect(sectionsSource).toContain('data-assistant-task-list-disclosure="true"');
    expect(sectionsSource).toContain(
      "bg-dls-sidebar text-xs font-normal text-dls-secondary hover:bg-dls-list-hover hover:text-dls-text",
    );
  });
});
