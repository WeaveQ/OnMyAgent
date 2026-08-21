import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { isUpToDateUpdateStatus } from "../src/app/lib/update-check-status";

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
    expect(isUpToDateUpdateStatus({ state: "idle" })).toBe(false);
    expect(
      isUpToDateUpdateStatus({
        state: "idle",
        lastCheckedAt: Date.now(),
      }),
    ).toBe(true);
  });
});

describe("settings updates check feedback", () => {
  test("button awaits check then toasts latest via the shared predicate", () => {
    const view = readFileSync(
      path.join(
        import.meta.dir,
        "../src/react-app/domains/settings/pages/updates-view.tsx",
      ),
      "utf8",
    );
    expect(view).toMatch(
      /await props\.checkForUpdates\(\)[\s\S]*isUpToDateUpdateStatus\(status[\s\S]*account_menu\.update_latest/,
    );
  });
});
