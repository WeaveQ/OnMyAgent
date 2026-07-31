/**
 * Primary rail “Automation” (option B left nav) — structural wiring.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isAutomationRailView } from "../src/react-app/domains/session/sidebar/main-rail";
import {
  isKnownRailView,
  parseRailViewFromSearch,
} from "../src/react-app/domains/session/navigation/app-location";

const appRoot = join(import.meta.dir, "..");

describe("isAutomationRailView (shipped)", () => {
  test("accepts automation and legacy scheduledTasks", () => {
    expect(isAutomationRailView("automation")).toBe(true);
    expect(isAutomationRailView("scheduledTasks")).toBe(true);
    expect(isAutomationRailView("assistant")).toBe(false);
  });
});

describe("rail location recognizes automation view", () => {
  test("known view + URL parse", () => {
    expect(isKnownRailView("automation")).toBe(true);
    expect(isKnownRailView("scheduledTasks")).toBe(true);
    expect(parseRailViewFromSearch("?view=automation")).toBe("automation");
  });
});

describe("primary rail + assistant wiring", () => {
  test("main-rail exposes automation entry and icon", () => {
    const rail = readFileSync(
      join(appRoot, "src/react-app/domains/session/sidebar/main-rail.tsx"),
      "utf8",
    );
    const icons = readFileSync(
      join(
        appRoot,
        "src/react-app/domains/session/sidebar/primary-rail-icons.tsx",
      ),
      "utf8",
    );
    expect(rail).toContain('id: "automation"');
    expect(rail).toContain("AutomationRailIcon");
    expect(rail).toContain("isAutomationRailView");
    // Third top-rail slot: Home → Experts → Automation → Files → …
    const topOrder = [...rail.matchAll(/id: "(assistant|chat|automation|files)"/g)].map(
      (m) => m[1],
    );
    expect(topOrder.slice(0, 4)).toEqual([
      "assistant",
      "chat",
      "automation",
      "files",
    ]);
    expect(icons).toContain("export function AutomationRailIcon");
    expect(icons).toContain("CalendarClock");
  });

  test("assistant mounts AutomationNavSidebar + controlled AutomationPage", () => {
    const assistant = readFileSync(
      join(appRoot, "src/react-app/domains/session/pages/assistant.tsx"),
      "utf8",
    );
    expect(assistant).toContain("AutomationNavSidebar");
    expect(assistant).toContain("openRailView(\"automation\")");
    expect(assistant).toContain("hideStatusTabs");
    expect(assistant).toContain("createRequestId={automationCreateRequestId}");
    // Absolute fill so content paints over keep-alive stack (not in-flow middle).
    expect(assistant).toContain("absolute inset-0 z-[1]");
    // Home session list still present for assistant (not removed this goal).
    expect(assistant).toContain("AgentConversationPanel");
  });

  test("expert rail opens assistant automation URL (does not crash on expert)", () => {
    const expert = readFileSync(
      join(appRoot, "src/react-app/domains/session/pages/expert.tsx"),
      "utf8",
    );
    const openRail = readFileSync(
      join(appRoot, "src/react-app/domains/session/pages/open-automation-rail.ts"),
      "utf8",
    );
    expect(expert).toContain("isAutomationRailView");
    expect(expert).toContain("openAutomationRailPath");
    expect(openRail).toContain('view: "automation"');
    expect(openRail).toContain("workspaceAssistantRoute");
    // Expert treats automation as handled (no feature-placeholder crash path).
    expect(expert).toMatch(/isAutomationRailView\(activeSidebarView\)/);
  });

  test("nav i18n short labels exist", () => {
    for (const locale of ["en", "zh", "zh-TW"] as const) {
      const nav = readFileSync(
        join(appRoot, `src/i18n/locales/${locale}/nav.ts`),
        "utf8",
      );
      expect(nav).toContain("nav.automation_short");
    }
  });
});
