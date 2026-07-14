import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("composer editor typography contract", () => {
  test("matches the placeholder size to the composer input text", () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/composer/editor.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      'absolute left-0 top-0 text-sm leading-5 text-dls-secondary/70',
    );
    expect(source).not.toContain(
      'absolute left-0 top-0 text-xs leading-5 text-dls-secondary/70',
    );
  });
});
