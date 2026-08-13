import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  isKnownRailView,
  parseRailViewFromSearch,
} from "../src/react-app/domains/session/navigation/app-location";
import { isTaskCenterRailVisible } from "../src/react-app/domains/session/sidebar/task-center-rail-visibility";

const appRoot = join(import.meta.dir, "..");

describe("Task Center primary rail", () => {
  test("recognizes and preserves the Task Center location", () => {
    expect(isKnownRailView("taskCenter")).toBe(true);
    expect(parseRailViewFromSearch("?view=taskCenter")).toBe("taskCenter");
    // bun / Vite dev are not PROD — packaged builds hide the rail entry.
    expect(isTaskCenterRailVisible()).toBe(true);
  });

  test("mounts the assistant-owned Task Center and redirects expert clicks", () => {
    const rail = readFileSync(
      join(appRoot, "src/react-app/domains/session/sidebar/main-rail.tsx"),
      "utf8",
    );
    const visibility = readFileSync(
      join(appRoot, "src/react-app/domains/session/sidebar/task-center-rail-visibility.ts"),
      "utf8",
    );
    const assistant = readFileSync(
      join(appRoot, "src/react-app/domains/session/pages/assistant.tsx"),
      "utf8",
    );
    const pageView = readFileSync(
      join(appRoot, "src/react-app/shell/session-route/page-view.tsx"),
      "utf8",
    );
    const expertRail = readFileSync(
      join(appRoot, "src/react-app/domains/session/pages/expert-page-rail.tsx"),
      "utf8",
    );
    const opener = readFileSync(
      join(appRoot, "src/react-app/domains/session/pages/open-task-center-rail.ts"),
      "utf8",
    );
    expect(rail).toContain('id: "taskCenter"');
    expect(rail).toContain("TaskCenterRailIcon");
    expect(rail).toContain("isTaskCenterRailVisible");
    expect(visibility).toContain("import.meta.env.PROD");
    expect(pageView).toContain("<TaskCenterPage");
    expect(pageView).toContain("taskCenterSlot=");
    expect(assistant).toContain("props.taskCenterSlot");
    expect(assistant).toContain('activeSidebarView === "taskCenter"');
    expect(expertRail).toContain("openTaskCenterRailPath");
    expect(opener).toContain('view: "taskCenter"');
  });

  test("ships a distinct localized rail label", () => {
    for (const locale of ["en", "zh", "zh-TW"] as const) {
      const nav = readFileSync(
        join(appRoot, `src/i18n/locales/${locale}/nav.ts`),
        "utf8",
      );
      expect(nav).toContain("nav.task_center");
      expect(nav).toContain("nav.task_center_short");
    }
  });
});
