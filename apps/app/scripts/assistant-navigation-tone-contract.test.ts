import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("assistant navigation tone contract", () => {
  test("keeps assistant navigation on quiet neutral surfaces", () => {
    const controls = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/components/shared-pages/assistant-sidebar-controls.tsx",
      ),
      "utf8",
    );
    const panel = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/components/shared-pages/agent-conversation-panel.tsx",
      ),
      "utf8",
    );

    expect(controls).toContain("bg-dls-list-selected");
    expect(controls).toContain("hover:bg-dls-list-hover");
    expect(panel).toContain('"flex shrink-0 flex-col bg-dls-background pb-5"');
    expect(panel).toContain('mode === "assistant" && "px-2.5"');
    expect(panel).not.toContain('mode === "assistant" && "bg-dls-sidebar px-2.5"');
  });
});
