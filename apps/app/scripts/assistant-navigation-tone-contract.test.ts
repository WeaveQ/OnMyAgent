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

  test("separates the WorkBuddy-style chat canvas from the right panel surface", () => {
    const chatPage = readFileSync(
      join(repoRoot, "apps/app/src/react-app/domains/session/chat/session-page.tsx"),
      "utf8",
    );
    const assistantPage = readFileSync(
      join(repoRoot, "apps/app/src/react-app/domains/session/pages/assistant.tsx"),
      "utf8",
    );
    const expertPage = readFileSync(
      join(repoRoot, "apps/app/src/react-app/domains/session/pages/expert.tsx"),
      "utf8",
    );
    const surface = readFileSync(
      join(repoRoot, "apps/app/src/react-app/domains/session/surface/session-surface.tsx"),
      "utf8",
    );

    expect(chatPage).toContain(
      "relative min-w-0 flex-1 overflow-hidden bg-dls-background mac:bg-dls-background",
    );
    expect(chatPage).toContain(
      'className="min-h-0 overflow-hidden bg-dls-surface lg:flex lg:flex-col"',
    );
    expect(assistantPage).toContain(
      "relative min-w-0 flex-1 overflow-hidden bg-dls-background mac:bg-dls-background",
    );
    expect(assistantPage).toContain(
      'className="min-h-0 overflow-hidden bg-dls-surface lg:flex lg:flex-col"',
    );
    expect(expertPage).toContain(
      "relative min-w-0 flex-1 overflow-hidden bg-dls-background mac:bg-dls-background",
    );
    expect(expertPage).toContain(
      'className="min-h-0 overflow-hidden bg-dls-surface lg:flex lg:flex-col"',
    );
    expect(surface).toContain(
      'className="flex h-12 shrink-0 items-center justify-between bg-dls-background px-5"',
    );
  });

  test("keeps the task header on its sidebar surface", () => {
    const sections = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/components/shared-pages/assistant-conversation-sections.tsx",
      ),
      "utf8",
    );

    expect(sections).toContain(
      "rounded-lg bg-dls-sidebar px-2 text-dls-text",
    );
  });

  test("keeps the local agent list on the shared sidebar surface", () => {
    const localAgents = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/chat/personal-local-agent-page.tsx",
      ),
      "utf8",
    );

    expect(localAgents).toContain(
      'className="flex shrink-0 flex-col overflow-hidden bg-dls-sidebar pb-5"',
    );
  });
});
