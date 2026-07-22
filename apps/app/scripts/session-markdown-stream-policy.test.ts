/**
 * P2: streaming markdown heavy-enhance budget (shipped pure helper + structural).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { shouldRunMarkdownHeavyEnhance } from "../src/react-app/capabilities/artifacts/markdown-stream-policy";

const appRoot = join(import.meta.dir, "..");

describe("shouldRunMarkdownHeavyEnhance (shipped)", () => {
  test("blocks heavy work while streaming", () => {
    expect(shouldRunMarkdownHeavyEnhance(true)).toBe(false);
    expect(shouldRunMarkdownHeavyEnhance(undefined)).toBe(true);
    expect(shouldRunMarkdownHeavyEnhance(false)).toBe(true);
  });
});

describe("MarkdownBlock streaming budget (structural)", () => {
  test("Shiki, KaTeX, and Mermaid setup gate on shouldRunMarkdownHeavyEnhance", () => {
    const source = readFileSync(
      join(appRoot, "src/react-app/capabilities/artifacts/markdown.tsx"),
      "utf8",
    );
    expect(source).toContain('from "./markdown-stream-policy"');
    expect(source).toContain("shouldRunMarkdownHeavyEnhance(props.streaming)");
    // At least three heavy paths (math, mermaid, shiki) share the gate.
    const gateHits = source.split("shouldRunMarkdownHeavyEnhance(props.streaming)").length - 1;
    expect(gateHits).toBeGreaterThanOrEqual(3);
    // Must not call setupMarkdownMermaid while streaming is true (effect returns early).
    expect(source).toMatch(
      /shouldRunMarkdownHeavyEnhance\(props\.streaming\)\) return;[\s\S]{0,120}setupMarkdownMermaid/,
    );
  });
});
