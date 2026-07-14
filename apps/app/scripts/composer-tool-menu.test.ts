import { describe, expect, test } from "bun:test";
import {
  collaborationModeOptionKeys,
  filterToolMenuItems,
  pluginSkillFileSearchText,
} from "../src/react-app/domains/session/surface/composer/tool-menu-model";

describe("composer tool menu model", () => {
  test("keeps pursue goal out of office collaboration modes", () => {
    expect(collaborationModeOptionKeys("office")).toEqual(["craft", "ask", "plan"]);
    expect(collaborationModeOptionKeys("legacy")).toEqual(["planning", "pursueGoal"]);
  });

  test("filters skills by name or description while preserving source order", () => {
    const items = [
      { name: "review", description: "Review code changes" },
      { name: "xlsx", description: "Analyze spreadsheet data" },
      { name: "init", description: "Guided project setup" },
    ];

    expect(
      filterToolMenuItems(items, "  SPREADSHEET  ", (item) =>
        `${item.name} ${item.description}`,
      ),
    ).toEqual([items[1]]);
    expect(filterToolMenuItems(items, "", (item) => item.name)).toEqual(items);
  });

  test("filters connectors across names and descriptions", () => {
    const items = [
      { name: "Local Browser", description: "Control the desktop browser" },
      { name: "DingTalk", description: "Send team messages" },
    ];

    expect(
      filterToolMenuItems(items, "desktop", (item) =>
        `${item.name} ${item.description}`,
      ),
    ).toEqual([items[0]]);
    expect(filterToolMenuItems(items, "dingt", (item) => item.name)).toEqual([items[1]]);
  });

  test("indexes imported plugin files by their visible object type", () => {
    expect(
      pluginSkillFileSearchText({ title: "Review changes", objectType: "command" }),
    ).toBe("Review changes Command");
    expect(
      pluginSkillFileSearchText({ title: "Spreadsheet helper", objectType: "skill" }),
    ).toBe("Spreadsheet helper Skill");
  });
});
