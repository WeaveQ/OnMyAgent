import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

describe("main rail primary icon contract", () => {
  test("assistant and expert entries use the dedicated reference icons", () => {
    const railSource = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/components/shared-pages/main-rail.tsx",
      ),
      "utf8",
    );
    const iconSource = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/components/shared-pages/primary-rail-icons.tsx",
      ),
      "utf8",
    );

    expect(railSource).toContain('icon: AssistantRailIcon');
    expect(railSource).toContain('icon: ExpertRailIcon');
    expect(railSource).not.toContain('BotMessageSquare');
    expect(railSource).not.toContain('UserStar');
    expect(iconSource).toContain('viewBox="0 0 16 16"');
    expect(iconSource).toContain('fill="currentColor"');
  });
});
