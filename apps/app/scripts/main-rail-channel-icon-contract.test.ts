import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("main rail channel icon contract", () => {
  test("uses the WeChat bubble glyph with the shared rail color states", () => {
    const railSource = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/components/shared-pages/main-rail.tsx",
      ),
      "utf8",
    );
    const primitiveSource = readFileSync(
      join(repoRoot, "apps/app/src/components/ui/action-row.tsx"),
      "utf8",
    );

    expect(railSource).toContain("icon: WeChatBubblesIcon");
    expect(railSource).toContain('fill="currentColor"');
    expect(railSource).toContain('className="fill-dls-rail"');
    expect(railSource).not.toContain("MessagesSquare");
    expect(railSource).toContain('get label() { return t("nav.channels"); }');
    expect(railSource).not.toContain("wechat.png");
    expect(primitiveSource).toContain('true: "text-dls-text"');
    expect(primitiveSource).not.toContain('true: "bg-dls-rail-active text-dls-text"');
    expect(primitiveSource).toContain(
      'false: "text-dls-secondary hover:text-dls-text"',
    );
    expect(primitiveSource).not.toContain("hover:bg-dls-rail-hover");
  });
});
