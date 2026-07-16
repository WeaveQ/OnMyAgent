import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("assistant draft home brand contract", () => {
  test("reuses the subtle onboarding logo above the draft title", () => {
    const source = readFileSync(
      join(
        import.meta.dir,
        "../src/react-app/domains/session/surface/session-surface.tsx",
      ),
      "utf8",
    );

    expect(source).toContain(
      'src={resolvePublicAssetUrl("/onmyagent-logo.png")}',
    );
    expect(source).toContain('className="mb-3 size-20 object-contain opacity-10"');
    expect(source).toContain('aria-hidden="true"');
  });
});
