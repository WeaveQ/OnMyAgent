/**
 * Settings nav IA: workspace vs personal vs global boundaries.
 */
import { describe, expect, test } from "bun:test";

import {
  getDataSettingsTabs,
  getGlobalSettingsTabs,
  getPersonalMemorySettingsTabs,
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
    // Environment is fused into System, not a top-level nav entry.
    expect(tabs).not.toContain("environment");
    expect(tabs).not.toContain("company");
    expect(tabs).not.toContain("ai");
  });

  test("data group lists usage, recovery, archive", () => {
    expect(getDataSettingsTabs()).toEqual([
      "usage",
      "recovery",
      "archived-tasks",
    ]);
  });
});
