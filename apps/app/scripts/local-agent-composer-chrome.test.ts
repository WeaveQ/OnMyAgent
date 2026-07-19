import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("local agent composer chrome aligns with workbench", () => {
  test("uses soft mist border and flush bottom accessory strip", () => {
    const composer = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/local-agents/local-agent-draft-composer.tsx",
      ),
      "utf8",
    );
    const page = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/local-agents/host/personal-local-agent-page.tsx",
      ),
      "utf8",
    );
    const footnote = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/local-agents/workspace-picker/workspace-footnote.tsx",
      ),
      "utf8",
    );

    expect(composer).toContain("bottomAccessory");
    expect(composer).toContain("border-dls-mist");
    expect(composer).toContain("rounded-t-xl rounded-b-none");
    expect(composer).toContain("data-local-agent-composer-footer");
    expect(composer).not.toContain("ring-2 ring-dls-accent/15");

    expect(page).toContain('density="compact"');
    expect(page).toContain("bottomAccessory=");
    expect(page).toContain("bg-gradient-to-t from-dls-background");
    expect(page).toContain("overflow-x-hidden");
    // Workspace + approval live under the card (workbench pattern).
    expect(page).toMatch(/bottomAccessory=\{[\s\S]*WorkspaceFootnote[\s\S]*SelectMenu/);
    // Approval select must not force w-full (was causing horizontal scrollbar).
    expect(page).toContain('className="w-auto max-w-[12rem] shrink-0"');

    expect(footnote).toContain('density?: "default" | "compact"');
    expect(footnote).toContain('density === "compact"');
  });
});
