import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

describe("main rail primary icon contract", () => {
  test("uses the larger shared rail width", () => {
    const railSource = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/main-rail.tsx",
      ),
      "utf8",
    );

    // Named rail width token (--dls-rail-width via w-rail), not arbitrary 68px.
    expect(railSource).toContain("w-rail shrink-0");
    expect(railSource).toContain("flex-1 flex-col items-center gap-2.5");
    expect(railSource).not.toContain("w-[68px]");
    // Brand mark above destinations (peer-app style app icon tile).
    expect(railSource).toContain("RailBrandMark");
    expect(railSource).toContain("onmyagent-logo.png");
  });

  test("top rail entries use unified Lucide outline icons (stroke language)", () => {
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
    // Local agents + management live under the account/settings menu, not the top rail.
    expect(railSource).not.toContain("icon: LocalAgentRailIcon");
    expect(railSource).not.toContain("icon: ManageRailIcon");
    expect(railSource).toContain('onOpenLocalAgent={() => props.onOpenView("localAgent")}');
    expect(railSource).toContain(
      'onOpenAgentManagement={() => props.onOpenView("agentManagement")}',
    );
    expect(railSource).toContain("icon: FilesRailIcon");
    expect(railSource).toContain("icon: ProjectsRailIcon");
    expect(railSource).toContain("icon: StoreRailIcon");
    expect(railSource).toContain("icon: AutomationRailIcon");

    // Outline set — no solid fill glyphs in the primary rail icon module.
    expect(iconSource).toContain('from "lucide-react"');
    expect(iconSource).toContain("House");
    expect(iconSource).toContain("UserRound");
    expect(iconSource).toMatch(/UserRound[\s\S]*ExpertRailIcon|ExpertRailIcon[\s\S]*UserRound/);
    expect(iconSource).not.toMatch(/\bBot\b/);
    expect(iconSource).toContain("Folder");
    expect(iconSource).toContain("Briefcase");
    expect(iconSource).not.toContain("SquareDashed");
    expect(iconSource).not.toContain("FileStack");
    expect(iconSource).toContain("ShoppingBag");
    expect(iconSource).toContain("Settings2");
    expect(iconSource).toContain("MonitorSmartphone");
    expect(iconSource).toContain("MessagesSquare");
    expect(iconSource).toContain("CalendarClock");
    expect(iconSource).toContain("RAIL_ICON_STROKE");
    expect(iconSource).toContain("strokeWidth: RAIL_ICON_STROKE");
    expect(iconSource).not.toContain('fill="currentColor"');
    expect(iconSource).not.toContain('viewBox="0 0 16 16"');

    expect(iconSource).toContain("export function LocalAgentRailIcon");
    expect(iconSource).toContain("export function FilesRailIcon");
    expect(iconSource).toContain("export function ProjectsRailIcon");
    expect(iconSource).toContain("export function StoreRailIcon");
    expect(iconSource).toContain("export function ManageRailIcon");
    expect(iconSource).toContain("export function DevicesRailIcon");
    expect(iconSource).toContain("export function AutomationRailIcon");
  });
});
