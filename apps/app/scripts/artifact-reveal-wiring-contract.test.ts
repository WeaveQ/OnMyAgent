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

  test("OpenableTargetsStrip always receives workspaceRoot on both render paths", () => {
    const list = read("src/react-app/domains/session/surface/message-list.tsx");
    const stripUsages = list.match(/<OpenableTargetsStrip[\s\S]*?\/>/g) ?? [];
    expect(stripUsages.length).toBeGreaterThanOrEqual(2);
    for (const usage of stripUsages) {
      expect(usage).toContain("workspaceRoot={props.workspaceRoot}");
    }
  });

  test("markdown reveal and strip use multi-candidate desktop reveal", () => {
    const list = read("src/react-app/domains/session/surface/message-list.tsx");
    expect(list).toContain("resolveArtifactRevealCandidates");
    expect(list).toContain("revealDesktopItemCandidates");
    expect(list).not.toMatch(/function absoluteArtifactPath\(/);
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
