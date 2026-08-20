import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { isUpToDateUpdateStatus } from "../src/react-app/domains/settings/state/electron-updater-state";

describe("isUpToDateUpdateStatus", () => {
  test("true only for a quiet idle check", () => {
    expect(isUpToDateUpdateStatus(null)).toBe(false);
    expect(isUpToDateUpdateStatus({ state: "checking" })).toBe(false);
    expect(isUpToDateUpdateStatus({ state: "available", version: "0.5.25" })).toBe(false);
    expect(
      isUpToDateUpdateStatus({
        state: "idle",
        message: "Could not reach the update server.",
        soft: true,
      }),
    ).toBe(false);
    expect(
      isUpToDateUpdateStatus({
        state: "idle",
        lastCheckedAt: Date.now(),
      }),
    ).toBe(true);
  });
});

describe("settings updates check feedback", () => {
  test("manual check toasts the same latest copy as the account menu", () => {
    const view = readFileSync(
      path.join(
        import.meta.dir,
        "../src/react-app/domains/settings/pages/updates-view.tsx",
      ),
      "utf8",
    );
    expect(view).toContain("isUpToDateUpdateStatus");
    expect(view).toContain("account_menu.update_latest");
    expect(view).toContain("showToast");
  });
});
