import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("composer editor typography contract", () => {
  test("aligns input, caret, and placeholder on the same line box", () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/editor.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      'absolute left-0 top-0 text-[13px] leading-5 text-dls-secondary/70',
    );
    expect(source).toContain(
      'bg-transparent text-[13px] leading-5 text-dls-text outline-none',
    );
    expect(source).not.toContain(
      'bg-transparent text-sm leading-6 text-dls-text outline-none',
    );
  });
});
