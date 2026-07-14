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
    expect(panel).toContain('"flex shrink-0 flex-col bg-dls-sidebar pb-5"');
    expect(panel).toContain('mode === "assistant" && "px-2.5"');
  });

  test("keeps chat canvases on the editor surface", () => {
    const chatPage = readFileSync(
      join(repoRoot, "apps/app/src/react-app/domains/session/chat/session-page.tsx"),
      "utf8",
    );

    expect(chatPage).toContain(
      "flex min-h-0 flex-1 flex-col overflow-hidden bg-dls-surface mac:bg-dls-surface",
    );
    expect(chatPage).toContain(
      "relative min-w-0 flex-1 overflow-hidden bg-dls-surface mac:bg-dls-surface",
    );
  });
});
