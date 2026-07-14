import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL(
    "../src/react-app/domains/session/surface/plan-goal/goal-runtime.tsx",
    import.meta.url,
  ),
  "utf8",
);

describe("goal runtime panel", () => {
  test("uses the neutral circle-play action for resume", () => {
    const resumeAction = source.match(
      /\{props\.canResume \? \([\s\S]*?\) : null\}/,
    )?.[0];

    expect(resumeAction).toContain('variant="ghost"');
    expect(resumeAction).toContain("<CirclePlay size={14} />");
    expect(resumeAction).not.toContain("<Play size={14} />");
  });

  test("uses the neutral circle-pause action while running", () => {
    const pauseAction = source.match(
      /\{props\.canPause \? \([\s\S]*?\) : null\}/,
    )?.[0];

    expect(pauseAction).toContain('variant="ghost"');
    expect(pauseAction).toContain("<CirclePause size={14} />");
    expect(pauseAction).not.toContain("<Pause size={14} />");
  });
});
