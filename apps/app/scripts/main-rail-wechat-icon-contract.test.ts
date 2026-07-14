import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("main rail WeChat icon contract", () => {
  test("uses the channel's existing WeChat brand asset", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/session/components/shared-pages/main-rail.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('resolvePublicAssetUrl("/connector-icons/wechat.png")');
    expect(source).toContain('get label() { return t("messaging.wechat"); }');
    expect(source).not.toContain("MessagesSquare");
  });
});
