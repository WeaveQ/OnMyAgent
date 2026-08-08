/**
 * Settings nav IA: workspace vs personal vs global boundaries.
 */
import { describe, expect, test } from "bun:test";

import {
  getDataSettingsTabs,
  getGlobalSettingsTabs,
  getPersonalMemorySettingsTabs,
  getSettingsNavSections,
  getWorkspaceSettingsTabs,
} from "../src/react-app/domains/settings/shell/settings-page";

describe("settings personal & memory navigation (shipped)", () => {
  test("personal memory group lists both settings tabs", () => {
    const tabs = getPersonalMemorySettingsTabs();
    expect(tabs).toContain("memory");
    expect(tabs).toContain("conversation-memory");
    expect(tabs).toHaveLength(2);
  });

  test("workspace group is models + company only", () => {
    const tabs = getWorkspaceSettingsTabs();
    expect(tabs).toEqual(["ai", "company"]);
    expect(tabs).not.toContain("preferences");
    expect(tabs).not.toContain("memory");
    expect(tabs).not.toContain("conversation-memory");
  });

  test("global group hosts preferences then system runtime tabs", () => {
    const tabs = getGlobalSettingsTabs(false);
    expect(tabs).toEqual([
      "preferences",
      "system",
      "shortcuts",
      "updates",
    ]);
    // Preferences lead Global (app-wide appearance), not Workspace.
    expect(tabs[0]).toBe("preferences");
    // Environment is fused into System, not a top-level nav entry.
    expect(tabs).not.toContain("environment");
    expect(tabs).not.toContain("company");
    expect(tabs).not.toContain("ai");
  });

  test("developer mode appends debug only on Global", () => {
    expect(getGlobalSettingsTabs(true)).toEqual([
      "preferences",
      "system",
      "shortcuts",
      "updates",
      "debug",
    ]);
    expect(getWorkspaceSettingsTabs()).not.toContain("debug");
  });

  test("data group lists recovery and archive (usage nav hidden)", () => {
    expect(getDataSettingsTabs()).toEqual(["recovery", "archived-tasks"]);
    expect(getDataSettingsTabs()).not.toContain("usage");
  });

  test("sidebar and section menu share nav section label keys", () => {
    const sections = getSettingsNavSections(false);
    expect(sections.map((s) => s.labelKey)).toEqual([
      null,
      "settings.group_workspace",
      "settings.group_personal_memory",
      "settings.group_global",
      "settings.group_data",
    ]);
    // Residual IA bug: never label data group as archived.
    expect(sections.map((s) => s.labelKey)).not.toContain(
      "settings.group_archived",
    );
    const data = sections.find((s) => s.labelKey === "settings.group_data");
    expect(data?.tabs).toEqual(["recovery", "archived-tasks"]);
    expect(data?.tabs).not.toContain("usage");
    const personal = sections.find(
      (s) => s.labelKey === "settings.group_personal_memory",
    );
    expect(personal?.tabs).toEqual(["memory", "conversation-memory"]);
  });
});
