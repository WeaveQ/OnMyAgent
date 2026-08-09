import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const headerSource = readFileSync(
  join(
    import.meta.dir,
    "../src/react-app/domains/session/sidebar/agent-conversation-panel-header.tsx",
  ),
  "utf8",
);
const panelSource = readFileSync(
  join(
    import.meta.dir,
    "../src/react-app/domains/session/sidebar/agent-conversation-panel.tsx",
  ),
  "utf8",
);
const expertPageSource = [
  readFileSync(
    join(import.meta.dir, "../src/react-app/domains/session/pages/expert.tsx"),
    "utf8",
  ),
  readFileSync(
    join(import.meta.dir, "../src/react-app/domains/session/pages/use-expert-page.tsx"),
    "utf8",
  ),
  readFileSync(
    join(import.meta.dir, "../src/react-app/domains/session/pages/expert-page-layout.tsx"),
    "utf8",
  ),
].join("\n");

describe("expert create CTA theme contract", () => {
  test("pins summon-experts footer under the expert list, not under search", () => {
    expect(headerSource).not.toContain("data-expert-create");
    expect(panelSource).toContain('data-expert-create="true"');
    expect(panelSource).toContain("session.summon_experts");
    expect(panelSource).toContain("session.add_expert_from_market");
    expect(panelSource).toContain("session.create_expert_yourself");
    expect(panelSource).toContain("DropdownMenu");
  });

  test("uses a slightly darker light surface while preserving the dark treatment", () => {
    expect(panelSource).toContain('size="sidebar-cta"');
    expect(panelSource).toContain("SIDEBAR_FOOTER_CTA_CLASS");
    const chromeSource = readFileSync(
      join(import.meta.dir, "../src/components/ui/sidebar-chrome.ts"),
      "utf8",
    );
    expect(chromeSource).toContain("bg-dls-active");
    expect(chromeSource).toContain("dark:bg-dls-surface-muted");
    expect(chromeSource).toContain("text-dls-text");
    expect(chromeSource).toContain("hover:bg-dls-hover");
    expect(chromeSource).not.toContain("bg-dls-decision");
  });

  test("self-create opens the expert creation wizard, not the office chat prompt", () => {
    // Sidebar footer + store both use openExpertCreation (ExpertCreationPage).
    expect(expertPageSource).toContain("onCreateExpert={openExpertCreation}");
    expect(expertPageSource).not.toMatch(
      /onCreateExpert=\{handleCreateExpert\}/,
    );
  });
});
