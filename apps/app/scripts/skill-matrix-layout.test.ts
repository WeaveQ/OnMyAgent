import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  skillMatrixGridStyle,
  skillMatrixUsesSharedOverflowScroller,
} from "../src/react-app/domains/local-agents/agent-management/skill-matrix-layout";

describe("skillMatrixGridStyle", () => {
  test("uses fixed agent and action column tracks", () => {
    const style = skillMatrixGridStyle(3);
    expect(style.gridTemplateColumns).toContain("repeat(3, 48px)");
    expect(style.gridTemplateColumns).toContain("64px");
  });

  test("clamps zero agents to one track", () => {
    expect(skillMatrixGridStyle(0).gridTemplateColumns).toContain("repeat(1, 48px)");
  });
});

describe("skill matrix sticky scroller contract", () => {
  test("matrix component keeps sticky header in shared overflow parent", () => {
    const src = readFileSync(
      path.join(
        import.meta.dir,
        "../src/react-app/domains/local-agents/agent-management/agent-management-skill-matrix.tsx",
      ),
      "utf8",
    );
    expect(skillMatrixUsesSharedOverflowScroller(src)).toBe(true);
    expect(src).toContain('from "./skill-matrix-layout"');
  });
});
