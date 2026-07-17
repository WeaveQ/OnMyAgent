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

  test("uses 13px primary text with 12px auxiliary text", () => {
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

    expect(primitiveSource).toContain('sidebar: "h-8 gap-2 rounded-lg px-2 text-[13px] font-normal"');
    expect(primitiveSource).toContain('className: "font-medium"');
    expect(controlsSource).toContain("px-4 text-[13px] transition-colors");
    expect(controlsSource).toContain('? "font-medium text-dls-text"');
    expect(controlsSource).toContain(': "font-normal text-dls-text');
    expect(controlsSource).toContain('<Icon className="size-4 shrink-0" />');
    expect(controlsSource).not.toContain(
      '<Icon className="size-4 shrink-0 text-dls-secondary" />',
    );
    expect(taskSource).toContain('props.selected ? "font-medium" : "font-normal"');
    expect(taskSource).toContain("text-left text-[13px] leading-5");
    expect(taskSource).toContain(
      "shrink-0 text-xs leading-5 text-dls-text/30",
    );
    expect(sectionsSource).toContain(
      'gap-1.5 text-[13px] font-normal text-dls-secondary',
    );
    expect(sectionsSource).toContain(
      'truncate text-xs font-normal text-dls-secondary',
    );
    expect(sectionsSource).toContain('className="text-[13px] hover:bg-dls-hover"');
    expect(sectionsSource).toContain(
      'text-dls-text-tertiary hover:bg-dls-active hover:text-dls-secondary',
    );
  });
});
