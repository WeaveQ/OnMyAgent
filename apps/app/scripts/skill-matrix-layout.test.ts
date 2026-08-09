import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  skillMatrixGridStyle,
  skillMatrixUsesSharedOverflowScroller,
} from "../src/react-app/domains/local-agents/agent-management/skill-matrix-layout";

describe("skillMatrixGridStyle", () => {
  test("skill | actions | agents — actions left of right-aligned agent pack", () => {
    const style = skillMatrixGridStyle(3);
    expect(style.gridTemplateColumns).toBe(
      "minmax(12rem,1fr) 64px repeat(3, 48px)",
    );
  });

  test("clamps zero agents to one track", () => {
    expect(skillMatrixGridStyle(0).gridTemplateColumns).toContain("repeat(1, 48px)");
  });
});

describe("skill matrix row action visibility", () => {
  test("row actions are not hover-only", () => {
    const src = readFileSync(
      path.join(
        import.meta.dir,
        "../src/react-app/domains/local-agents/agent-management/agent-management-skill-matrix.tsx",
      ),
      "utf8",
    );
    expect(src).not.toMatch(
      /SkillMatrixActionTrack[\s\S]{0,80}opacity-0[\s\S]{0,40}group-hover:opacity-100/,
    );
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
