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
import { buildAutomationNavGroups } from "../src/react-app/domains/session/pages/use-automation-nav-groups";
import { buildAutomationEmbeddedSessionPath } from "../src/react-app/domains/session/pages/open-automation-embedded-session";

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
    // Task Center is distinct from scheduled Automation.
    const topOrder = [...rail.matchAll(/id: "(assistant|chat|taskCenter|automation|files)"/g)].map(
      (m) => m[1],
    );
    expect(topOrder.slice(0, 5)).toEqual([
      "assistant",
      "chat",
      "taskCenter",
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
    // Left nav also shows home-style automation run groups.
    expect(assistant).toContain("useAutomationNavGroups");
    expect(assistant).toContain("groups={automationNavGroups}");
    // Opening a run stays on the automation rail (embedded SessionSurface).
    expect(assistant).toContain("openAutomationEmbeddedSession");
    expect(assistant).toContain("showAutomationEmbeddedSession");
    expect(assistant).toContain("sessionSurfaceActive");
    expect(assistant).toContain("buildAutomationEmbeddedSessionPath");
    // Must not fall back to sidebar.onOpenSession for embed (strips ?view=).
    expect(assistant).toMatch(
      /openAutomationEmbeddedSession[\s\S]*?navigate\(path\)/,
    );
  });

  test("buildAutomationEmbeddedSessionPath keeps ?view=automation", () => {
    const path = buildAutomationEmbeddedSessionPath({
      workspaceId: "ws-1",
      sessionId: "ses-9",
    });
    expect(path).toContain("/workspace/ws-1/assistant/ses-9");
    expect(path).toContain("view=automation");
    expect(buildAutomationEmbeddedSessionPath({ workspaceId: "", sessionId: "x" })).toBeNull();
  });

  test("buildAutomationNavGroups folds runs under one task", () => {
    const now = Date.now();
    const groups = buildAutomationNavGroups({
      workspaceId: "ws-test",
      records: [
        {
          sessionId: "s1",
          automationId: "a1",
          title: "家人联系提醒",
          groupName: "g",
          outputDirectory: "",
          category: "office",
          createdAt: now,
        },
        {
          sessionId: "s2",
          automationId: "a1",
          title: "家人联系提醒",
          groupName: "g",
          outputDirectory: "",
          category: "office",
          createdAt: now - 1000,
        },
      ],
      sessions: [
        {
          id: "s1",
          title: "家人联系提醒",
          time: { created: now, updated: now },
        },
        {
          id: "s2",
          title: "家人联系提醒",
          time: { created: now - 1000, updated: now - 1000 },
        },
      ] as never,
      categoryId: "office",
      excludedSessionIds: new Set(),
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe("家人联系提醒");
    expect(groups[0]?.sessions).toHaveLength(2);
  });

  test("expert rail opens assistant automation URL (does not crash on expert)", () => {
    const expert = [
      readFileSync(
        join(appRoot, "src/react-app/domains/session/pages/expert.tsx"),
        "utf8",
      ),
      readFileSync(
        join(appRoot, "src/react-app/domains/session/pages/use-expert-page.tsx"),
        "utf8",
      ),
      readFileSync(
        join(appRoot, "src/react-app/domains/session/pages/expert-page-layout.tsx"),
        "utf8",
      ),
      readFileSync(
        join(appRoot, "src/react-app/domains/session/pages/expert-page-rail.tsx"),
        "utf8",
      ),
    ].join("\n");
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
