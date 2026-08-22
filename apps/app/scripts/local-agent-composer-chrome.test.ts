import { describe, expect, test } from "bun:test";
import { resolveLocalAgentComposerLayout } from "../src/react-app/domains/local-agents/local-agent-composer-layout";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("local agent composer chrome aligns with workbench", () => {
  test("uses one solid composer surface and reference state-dependent controls", () => {
    const composer = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/local-agents/local-agent-draft-composer.tsx",
      ),
      "utf8",
    );
    const layout = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/local-agents/local-agent-composer-layout.ts",
      ),
      "utf8",
    );
    const page = [
      "apps/app/src/react-app/domains/local-agents/host/personal-local-agent-page.tsx",
      "apps/app/src/react-app/domains/local-agents/host/personal-local-agent-page-sections.tsx",
      "apps/app/src/react-app/domains/local-agents/host/use-personal-local-agent-page.ts",
    ]
      .map((path) => readFileSync(join(repoRoot, path), "utf8"))
      .join("\n");
    const footnote = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/local-agents/workspace-picker/workspace-footnote.tsx",
      ),
      "utf8",
    );

    expect(composer).not.toContain("bottomAccessory");
    expect(composer).not.toContain("data-local-agent-composer-footer");
    expect(composer).toContain("onStop");
    expect(composer).toContain("text-composer");
    expect(composer).toContain("placeholder:text-dls-secondary/70");
    expect(layout).toContain("border-dls-border");
    expect(layout).toContain('"rounded-xl"');
    expect(layout).not.toContain("rounded-t-[18px]");
    expect(layout).not.toContain("rounded-2xl");
    expect(layout).not.toContain("rounded-b-none");
    expect(layout).not.toContain("border-t-transparent");
    expect(layout).not.toContain("footer");
    expect(layout).toContain("focus-within:ring-1");
    expect(layout).toContain("focus-within:ring-dls-focus");
    expect(layout).not.toContain("focus-visible:!ring-0");
    expect(`${composer}\n${layout}`).not.toContain("ring-2 ring-dls-accent/15");

    expect(page).toContain('density="compact"');
    expect(page).not.toContain("bottomAccessory=");
    // Solid footer plate (no gradient glass wash).
    expect(page).toContain("Solid footer plate");
    expect(page).toContain("overflow-x-hidden");
    // Draft workspace and approval live in the primary action row.
    expect(page).toMatch(/toolbarLeft=\{[\s\S]*chipEditable[\s\S]*WorkspaceFootnote[\s\S]*LocalAgentComposerApprovalSelect/);
    expect(page).toContain('data-testid="local-agent-draft-workspace"');
    expect(page).toContain("onChange={setApprovalMode}");
    expect(page).not.toContain("readOnly={!chipEditable}");

    expect(footnote).toContain('density?: "default" | "compact"');
    expect(footnote).toContain('density === "compact"');
  });

  test("focus ring uses the same rounded-xl as idle, including with menus open", () => {
    const idle = resolveLocalAgentComposerLayout({
      hasAttachments: false,
      dragActive: false,
    });
    expect(idle.panelRoundedClass).toBe("rounded-xl");
    expect(idle.panelChromeClass).toContain("focus-within:ring-1");
    expect(idle.panelChromeClass).not.toContain("rounded-b-none");
  });

  test("online placeholder copy matches Expert/Assistant composer watermark", () => {
    const { setLocale, t } = require("../src/i18n") as typeof import("../src/i18n");
    for (const locale of ["zh", "zh-TW", "en"] as const) {
      setLocale(locale);
      expect(t("local_agent.input_placeholder")).toBe(t("composer.placeholder"));
    }
  });
});
