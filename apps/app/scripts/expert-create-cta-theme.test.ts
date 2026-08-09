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
const createButtonStart = panelSource.indexOf('data-expert-create="true"');
const createButtonSource = panelSource.slice(
  panelSource.lastIndexOf("      <Button", createButtonStart),
  panelSource.indexOf("      </Button>", createButtonStart),
);

describe("expert create CTA theme contract", () => {
  test("pins create CTA under the expert list, not under search", () => {
    expect(headerSource).not.toContain("data-expert-create");
    expect(panelSource).toContain('data-expert-create="true"');
    expect(panelSource).toContain('mode === "agent" && props.onCreateExpert');
  });

  test("uses a slightly darker light surface while preserving the dark treatment", () => {
    expect(createButtonSource).toContain('variant="ghost"');
    expect(createButtonSource).toContain('size="sidebar-cta"');
    expect(createButtonSource).toContain("SIDEBAR_FOOTER_CTA_CLASS");
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
});
