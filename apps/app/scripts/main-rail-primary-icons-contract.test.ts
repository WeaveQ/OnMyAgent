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
    // Prefer lighter webp over the multi-hundred-KB PNG.
    expect(railSource).toContain("onmyagent-logo.webp");
    expect(railSource).not.toContain("onmyagent-logo.png");
    // Dark rail: near-black tile + blue mark — not a pure-white flash plate.
    expect(railSource).toContain("dark:bg-neutral-950");
    expect(railSource).not.toMatch(
      /function RailBrandMark[\s\S]*?dark:bg-white/,
    );
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
    expect(railSource).toContain("icon: CompanyRailIcon");
    expect(railSource).toContain("icon: AutomationRailIcon");
    expect(railSource).toContain('id: "company"');

    // Mostly Lucide outline; Experts is Koboyo user-star (inline SVG).
    expect(iconSource).toContain('from "lucide-react"');
    expect(iconSource).toContain("House");
    expect(iconSource).toContain("ExpertRailIcon");
    expect(iconSource).toContain("UserStarIcon");
    expect(iconSource).toMatch(
      /function ExpertRailIcon[\s\S]*UserStarIcon/,
    );
    expect(iconSource).toContain("RAIL_EXPERT_ICON_W");
    // Experts must not fall back to Lucide person / bot glyphs.
    expect(iconSource).not.toMatch(/\bUserRound\b/);
    expect(iconSource).not.toMatch(/\bBot\b/);
    expect(iconSource).not.toMatch(
      /function ExpertRailIcon[\s\S]*?return <(UserRound|Bot|Users)\b/,
    );
    expect(iconSource).toContain("Folder");
    expect(iconSource).toContain("Briefcase");
    expect(iconSource).not.toContain("SquareDashed");
    expect(iconSource).not.toContain("FileStack");
    expect(iconSource).toContain("ShoppingBag");
    expect(iconSource).toContain("Building2");
    expect(iconSource).toContain("Settings2");
    expect(iconSource).toContain("MonitorSmartphone");
    // Devices must not share LocalAgent's MonitorSmartphone glyph.
    expect(iconSource).toContain("HardDrive");
    expect(iconSource).toMatch(
      /DevicesRailIcon[\s\S]*HardDrive|HardDrive[\s\S]*DevicesRailIcon/,
    );
    expect(iconSource).toMatch(
      /function DevicesRailIcon[\s\S]*return <HardDrive/,
    );
    expect(iconSource).not.toMatch(
      /function DevicesRailIcon[\s\S]*return <MonitorSmartphone/,
    );
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
    expect(iconSource).toContain("export function CompanyRailIcon");
    expect(iconSource).toContain("export function ManageRailIcon");
    expect(iconSource).toContain("export function DevicesRailIcon");
    expect(iconSource).toContain("export function AutomationRailIcon");
  });

  test("live Devices UI uses HardDrive, not LocalAgent MonitorSmartphone", () => {
    const sidebar = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx",
      ),
      "utf8",
    );
    const viewModel = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/chat/session-page-sidebar-view-model.ts",
      ),
      "utf8",
    );
    const sidePanel = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/components/side-panel-pages.tsx",
      ),
      "utf8",
    );

    // Account footer Devices button (visible chrome).
    expect(sidebar).toMatch(
      /onOpenPrimaryView\("devices"\)[\s\S]*?<HardDrive className="size-5" \/>/,
    );
    expect(sidebar).not.toMatch(
      /onOpenPrimaryView\("devices"\)[\s\S]*?<MonitorSmartphone/,
    );

    // Sidebar feature icon map used by feature placeholders / panels.
    expect(viewModel).toMatch(/devices:\s*HardDrive/);
    expect(viewModel).toMatch(/localAgent:\s*MonitorSmartphone/);
    expect(viewModel).not.toMatch(/devices:\s*MonitorSmartphone/);

    // Side-panel SIDEBAR_VIEW_ICONS devices entry.
    expect(sidePanel).toMatch(/devices:\s*HardDrive/);
    expect(sidePanel).not.toMatch(/devices:\s*MonitorSmartphone/);
  });
});
