import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("assistant navigation typography contract", () => {
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

    expect(primitiveSource).toContain('sidebar: "h-8 gap-2 rounded-lg px-2 text-xs font-normal"');
    expect(primitiveSource).toContain('className: "font-semibold"');
    expect(controlsSource).toContain("px-4 text-xs transition-colors");
    expect(controlsSource).toContain('? "font-semibold text-dls-text"');
    expect(controlsSource).toContain(': "font-normal text-dls-secondary');
    expect(taskSource).toContain('props.selected ? "font-medium" : "font-normal"');
  });
});
