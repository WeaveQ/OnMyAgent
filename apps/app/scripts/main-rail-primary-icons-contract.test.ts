import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

describe("main rail primary icon contract", () => {
  test("uses the compact shared rail width", () => {
    const railSource = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/main-rail.tsx",
      ),
      "utf8",
    );

    expect(railSource).toContain('className="flex w-16 shrink-0');
    expect(railSource).toContain("-translate-y-0.5 flex-1 flex-col");
    expect(railSource).not.toContain("w-[72px]");
  });

  test("top rail entries use dedicated fill icons (not mixed Lucide strokes)", () => {
    const railSource = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/main-rail.tsx",
      ),
      "utf8",
    );
    const iconSource = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/primary-rail-icons.tsx",
      ),
      "utf8",
    );

    expect(railSource).toContain("icon: AssistantRailIcon");
    expect(railSource).toContain("icon: ExpertRailIcon");
    expect(railSource).toContain("icon: LocalAgentRailIcon");
    expect(railSource).toContain("icon: FilesRailIcon");
    expect(railSource).toContain("icon: StoreRailIcon");
    expect(railSource).toContain("icon: ManageRailIcon");
    expect(railSource).not.toContain("BotMessageSquare");
    expect(railSource).not.toContain("UserStar");
    expect(railSource).not.toContain("MonitorCog");
    expect(railSource).not.toContain("FolderOpen");
    expect(railSource).not.toContain("SlidersHorizontal");
    expect(railSource).not.toMatch(/\bStore\b/);
    expect(iconSource).toContain('viewBox="0 0 16 16"');
    expect(iconSource).toContain('fill="currentColor"');
    expect(iconSource).toContain("export function LocalAgentRailIcon");
    expect(iconSource).toContain("export function FilesRailIcon");
    expect(iconSource).toContain("export function StoreRailIcon");
    expect(iconSource).toContain("export function ManageRailIcon");
  });
});
