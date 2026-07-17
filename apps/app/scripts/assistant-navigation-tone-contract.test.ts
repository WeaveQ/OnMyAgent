import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("assistant navigation tone contract", () => {
  test("keeps assistant navigation on quiet neutral surfaces", () => {
    const controls = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/sidebar/assistant-sidebar-controls.tsx",
      ),
      "utf8",
    );
    const panel = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/sidebar/agent-conversation-panel.tsx",
      ),
      "utf8",
    );

    // Office/code switch uses shared SegmentedTabGroup + NavTabButton (market style).
    expect(controls).toContain("SegmentedTabGroup");
    expect(controls).toContain('size="tab"');
    expect(controls).toContain('shape="tab"');
    expect(controls).toContain("NavListButton");
    expect(panel).toContain("bg-dls-sidebar");
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
    const surfaceChrome = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/surface/session-surface-chrome.tsx",
      ),
      "utf8",
    );
    const composer = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/surface/composer/composer.tsx",
      ),
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
    expect(surfaceChrome).toContain(
      'className="flex h-12 shrink-0 items-center justify-between bg-dls-background px-5"',
    );
    expect(composer).toContain(
      "bg-gradient-to-t from-dls-background via-dls-background/95 to-transparent",
    );
    expect(composer).not.toContain(
      "bg-gradient-to-t from-dls-surface via-dls-surface/95 to-transparent",
    );
  });

  test("keeps the task header on its sidebar surface", () => {
    const sections = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/sidebar/assistant-conversation-sections.tsx",
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
        "apps/app/src/react-app/domains/local-agents/host/personal-local-agent-page.tsx",
      ),
      "utf8",
    );

    expect(localAgents).toContain("bg-dls-sidebar");
    expect(localAgents).toContain("overflow-hidden");
  });

  test("keeps draft prompt templates inside the composer add menu", () => {
    const surface = readFileSync(
      join(repoRoot, "apps/app/src/react-app/domains/session/surface/session-surface.tsx"),
      "utf8",
    );

    expect(surface).toContain("promptTemplates={");
    expect(surface).toContain("onSelectPromptTemplate={selectAssistantPromptTemplate}");
    expect(surface).not.toContain("<PersonalAssistantAccessory");
    expect(surface).not.toContain('<div className="mb-4 w-full max-w-5xl">');
  });

  test("limits the light composer border to assistant and expert draft homes", () => {
    const surface = readFileSync(
      join(repoRoot, "apps/app/src/react-app/domains/session/surface/session-surface.tsx"),
      "utf8",
    );

    expect(surface).toContain("const personalAssistantDraftHome =");
    expect(surface).toContain("const expertDraftHome =");
    expect(surface).toContain("Boolean(props.agentContext)");
    expect(surface).toContain(
      "personalAssistantDraftHome || expertDraftHome",
    );
    expect(surface).toContain(
      "showOuterBorder={composerOuterBorderVisible}",
    );
  });
});
