import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pagePath = join(
  import.meta.dir,
  "../src/react-app/domains/agents/expert-creation-page.tsx",
);

/**
 * Expert creation is a full-screen overlay (absolute inset-0 z-50). It covers
 * the global mac body::before drag strip, so the page header itself must be a
 * drag region or the window cannot be moved while creating an expert.
 */
describe("expert creation titlebar contract", () => {
  test("header is mac titlebar-drag; controls opt out", () => {
    const source = readFileSync(pagePath, "utf8");
    expect(source).toContain("mac:titlebar-drag");
    expect(source).toMatch(
      /<header className="[^"]*mac:titlebar-drag/,
    );
    // Title must not capture pointer (drag passes through to header).
    expect(source).toContain(
      'className="pointer-events-none text-base font-semibold tracking-tight text-dls-text"',
    );
    // Done cluster opts out (Button also has titlebar-no-drag via primitive).
    expect(source).toContain("mac:titlebar-no-drag");
  });
});
