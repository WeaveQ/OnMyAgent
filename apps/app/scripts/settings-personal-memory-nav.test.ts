/**
 * Settings nav must surface Personal + Memory tabs (work-memory M1 discoverability).
 */
import { describe, expect, test } from "bun:test";

import {
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

  test("workspace group no longer swallows personal/memory", () => {
    const tabs = getWorkspaceSettingsTabs();
    expect(tabs).toContain("preferences");
    expect(tabs).toContain("ai");
    expect(tabs).not.toContain("memory");
    expect(tabs).not.toContain("conversation-memory");
  });
});
