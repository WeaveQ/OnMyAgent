import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("assistant navigation typography contract", () => {
  test("uses the message-plus icon for creating a task", () => {
    const headerSource = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/sidebar/agent-conversation-panel-header.tsx",
      ),
      "utf8",
    );

    expect(headerSource).toContain("MessageCirclePlus");
    expect(headerSource).not.toContain("<CirclePlus");
  });

  test("uses text-sm list rhythm without arbitrary text-[Npx]", () => {
    const primitiveSource = readFileSync(
      join(repoRoot, "apps/app/src/components/ui/action-row.tsx"),
      "utf8",
    );
    const controlsSource = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/sidebar/assistant-sidebar-controls.tsx",
      ),
      "utf8",
    );
    const taskSource = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/sidebar/assistant-task-item.tsx",
      ),
      "utf8",
    );
    const sectionsSource = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/sidebar/assistant-conversation-sections.tsx",
      ),
      "utf8",
    );

    // NavList sidebar density: sm scale (not arbitrary 13px).
    expect(primitiveSource).toContain(
      'sidebar: "h-9 gap-2 rounded-xl px-2.5 text-sm font-normal"',
    );
    expect(controlsSource).toContain('size="sidebar"');
    expect(controlsSource).toContain('<Icon className="size-4 shrink-0" />');
    expect(taskSource).toContain('props.selected ? "font-medium" : "font-normal"');
    expect(taskSource).toContain("text-sm text-dls-text");
    // Idle meta time is xs, quiet secondary.
    expect(taskSource).toContain("tabular-nums text-xs font-normal leading-none text-dls-secondary/55");
    // List rows: shared text-sm leading-none (no text-[13px] drift).
    expect(sectionsSource).toContain("text-sm font-normal leading-none");
    expect(sectionsSource).not.toContain("text-[13px]");
    expect(taskSource).not.toContain("text-[13px]");
    expect(controlsSource).not.toContain("text-[13px]");
  });
});
