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
    expect(source).toContain('size="sidebar"');
    expect(source).toContain('className="space-y-0 pb-1 pt-3"');
  });

  test("keeps category tabs fluid and aligned with the primary actions", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/components/shared-pages/assistant-sidebar-controls.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("h-8 min-w-0 w-full");
    expect(source).toContain("mb-[18px] grid w-full grid-cols-2");
    expect(source).not.toContain("min-w-24");
    expect(source).not.toContain("w-24 rounded-lg");
  });

  test("keeps the task list close to the primary actions", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/components/shared-pages/assistant-conversation-sections.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('className="flex flex-col pt-1"');
  });

  test("uses the WorkBuddy assistant panel default width", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/components/shared-pages/session-panel-model.ts",
      ),
      "utf8",
    );

    expect(source).toContain("export const AGENT_PANEL_DEFAULT_WIDTH = 264;");
  });

  test("keeps the sidebar collapse control borderless and surface-aware", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/components/shared-pages/sidebar-pane-collapse-toggle.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("rounded-l-none rounded-r-md px-0");
    expect(source).not.toContain("border-y border-r border-l-0");
    expect(source).toContain('"bg-dls-rail before:bg-dls-rail"');
    expect(source).toContain('"bg-dls-sidebar before:bg-dls-sidebar"');
  });
});
