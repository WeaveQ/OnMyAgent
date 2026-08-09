import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

/**
 * List/workspace seam: flush panels (no gutter gap) + mist hairline + hit target.
 * A wide flex gutter read as an empty “interval” between expert list and chat.
 */
describe("agent panel resize handle contract", () => {
  test("shared handle is flush (zero net width) with mist hairline", () => {
    const handle = read(
      "src/react-app/domains/session/sidebar/agent-panel-resize-handle.tsx",
    );
    // Hit target cancelled by negative margins — no visible gutter gap.
    expect(handle).toMatch(/-ml-1\.5/);
    expect(handle).toMatch(/-mr-1\.5/);
    expect(handle).toContain("w-3");
    expect(handle).toContain("bg-dls-mist");
    expect(handle).toContain('role="separator"');
    expect(handle).not.toContain("bg-transparent");
  });

  test("expert and assistant hosts use AgentPanelResizeHandle", () => {
    for (const path of [
      "src/react-app/domains/session/pages/expert.tsx",
      "src/react-app/domains/session/pages/assistant.tsx",
    ]) {
      const source = read(path);
      expect(source, path).toContain("AgentPanelResizeHandle");
      expect(source, path).not.toContain(
        "absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent",
      );
    }
  });
});
