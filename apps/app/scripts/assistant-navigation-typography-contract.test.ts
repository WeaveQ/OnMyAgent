import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("assistant navigation typography contract", () => {
  test("uses the message-plus icon for creating a task", () => {
    const headerSource = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/components/shared-pages/agent-conversation-panel-header.tsx",
      ),
      "utf8",
    );

    expect(headerSource).toContain("MessageCirclePlus");
    expect(headerSource).not.toContain("<CirclePlus");
  });

  test("uses compact text with selection-driven emphasis", () => {
    const primitiveSource = readFileSync(
      join(repoRoot, "apps/app/src/components/ui/action-row.tsx"),
      "utf8",
    );
    const controlsSource = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/components/shared-pages/assistant-sidebar-controls.tsx",
      ),
      "utf8",
    );
    const taskSource = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/components/shared-pages/assistant-task-item.tsx",
      ),
      "utf8",
    );
    const sectionsSource = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/components/shared-pages/assistant-conversation-sections.tsx",
      ),
      "utf8",
    );

    expect(primitiveSource).toContain('sidebar: "h-8 gap-2 rounded-lg px-2 text-xs font-normal"');
    expect(primitiveSource).toContain('className: "font-medium"');
    expect(controlsSource).toContain("px-4 text-xs transition-colors");
    expect(controlsSource).toContain('? "font-medium text-dls-text"');
    expect(controlsSource).toContain(': "font-normal text-dls-text');
    expect(controlsSource).toContain('<Icon className="size-4 shrink-0" />');
    expect(controlsSource).not.toContain(
      '<Icon className="size-4 shrink-0 text-dls-secondary" />',
    );
    expect(taskSource).toContain('props.selected ? "font-medium" : "font-normal"');
    expect(taskSource).toContain("text-left text-xs leading-5");
    expect(taskSource).toContain("shrink-0 text-xs leading-none");
    expect(sectionsSource).toContain(
      'gap-1.5 text-xs font-normal text-dls-secondary',
    );
    expect(sectionsSource).toContain(
      'truncate text-xs font-normal text-dls-secondary',
    );
  });
});
