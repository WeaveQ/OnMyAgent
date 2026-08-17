import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function readSessionSurfaceSources() {
  return [
    read("src/react-app/domains/session/surface/session-surface.tsx"),
    read("src/react-app/domains/session/surface/session-surface-view.tsx"),
  ].join("\n");
}

describe("artifact reveal wiring contract", () => {
  test("SessionTranscript always receives workspaceRoot for Finder reveal", () => {
    const surface = readSessionSurfaceSources();
    expect(surface).toContain("export function SessionSurface");
    // View wires verified targets; host may pass as props.verifiedOpenTargets.
    expect(surface).toMatch(/openTargets=\{(?:props\.)?verifiedOpenTargets\}/);
    expect(surface).toContain("onOpenTarget={props.onOpenTarget}");
    expect(surface).toContain("workspaceRoot={props.workspaceRoot}");
  });

  test("OpenableTargetsStrip sends every generated file to the in-app preview", () => {
    const list = read("src/react-app/domains/session/surface/message-list/message-block-row.tsx");
    const stripUsages = list.match(/<OpenableTargetsStrip[\s\S]*?\/>/g) ?? [];
    expect(stripUsages.length).toBeGreaterThanOrEqual(2);
    for (const usage of stripUsages) {
      expect(usage).toContain("onOpenTarget={props.onOpenTarget}");
    }
    expect(list).toContain("onClick={() => props.onOpenTarget(target)}");
    expect(list).toContain("session-generated-artifact-card");
    expect(list).toContain("props.targets.length > 1 && \"sm:grid-cols-2\"");
    expect(list).toContain("<ArrowUpRight");
    expect(list).toContain("<StatusBadge");
    expect(list).toContain("borderLeftColor: `var(--dls-artifact-hue-${presentation.hue})`");
    expect(list).toContain("backgroundColor: `color-mix(in srgb, var(--dls-artifact-hue-${presentation.hue}) 20%, transparent)`");
    expect(list).not.toContain("const openInFolder = async");
  });

  test("generated file cards do not treat arbitrary file mentions as provenance", () => {
    const targetSelection = read(
      "src/react-app/domains/session/surface/message-list/open-targets.ts",
    );
    expect(targetSelection).toContain(
      "deriveOpenTargets(assistantMessages, { includeFileMentions: false })",
    );
    expect(targetSelection).not.toContain(
      "deriveOpenTargets(messages, { includeFileMentions: true })",
    );
  });

  test("turn card selection keeps user attachments in the current-turn input", () => {
    const list = read("src/react-app/domains/session/surface/message-list.tsx");
    expect(list).toContain("selectTurnOpenTargets(turn.messages, props.openTargets, {");
    expect(list).toContain("turnStartedAt: turn.startedAt");
  });

  test("markdown reveal keeps multi-candidate desktop reveal as a separate action", () => {
    const list = read("src/react-app/domains/session/surface/message-list.tsx");
    expect(list).toContain("resolveArtifactRevealCandidates");
    expect(list).toContain("revealDesktopItemCandidates");
    expect(list).not.toMatch(/function absoluteArtifactPath\(/);
  });

  test("auto-detected artifact buttons preview in-app and consume the click once", () => {
    const markdown = read("src/react-app/capabilities/artifacts/markdown.tsx");
    expect(markdown).toContain('inlineCode.dataset.markdownOpenMode = "preview"');
    expect(markdown).not.toContain('inlineCode.dataset.markdownOpenMode = "reveal"');
    expect(markdown).toContain("inlineCode.title = detected.path");
    expect(markdown).toContain("markdownFileLinkLabel(rawCode");
    expect(markdown).not.toContain('inlineCode.textContent = t("session.open_artifact")');
    expect(markdown).not.toContain('inlineCode.title = t("files.view_in_panel")');
    expect(markdown.match(/event\.stopPropagation\(\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("desktop reveal IPC returns ok/not_found instead of silent void", () => {
    const handler = readFileSync(
      join(root, "../desktop/electron/desktop-handlers/system.mjs"),
      "utf8",
    );
    expect(handler).toContain('reason: "not_found"');
    expect(handler).toContain('reason: "empty_path"');
    expect(handler).toContain("revealed_parent");

    const desktop = read("src/app/lib/desktop.ts");
    expect(desktop).toContain("export async function revealDesktopItemCandidates");
    expect(desktop).toContain("RevealDesktopItemResult");
  });
});
