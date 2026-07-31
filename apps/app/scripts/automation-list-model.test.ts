import { describe, expect, test } from "bun:test";

import {
  isAutomationLeaseActive,
  partitionAutomationTasks,
  resolvePostRunStatusTab,
} from "../src/react-app/domains/messaging/automation-list-model";

describe("automation lease activity", () => {
  const now = 1_700_000_000_000;

  test("expired lease is not active", () => {
    expect(
      isAutomationLeaseActive({ startedAt: now - 10_000, expiresAt: now - 1 }, now),
    ).toBe(false);
    expect(
      isAutomationLeaseActive({ startedAt: now - 10_000, expiresAt: now + 1 }, now),
    ).toBe(true);
  });

  test("partition moves expired running into scheduled bucket", () => {
    const { running, scheduled } = partitionAutomationTasks(
      [
        {
          id: "stuck",
          title: "家人联系提醒",
          scene: "office",
          enabled: true,
          schedule: { mode: "weekly" },
          running: { startedAt: now - 9_000_000, expiresAt: now - 1 },
          runs: [],
        },
        {
          id: "live",
          title: "live",
          scene: "office",
          enabled: true,
          schedule: { mode: "weekly" },
          running: { startedAt: now - 1_000, expiresAt: now + 60_000 },
          runs: [],
        },
      ],
      "office",
      now,
    );
    expect(running.map((item) => item.id)).toEqual(["live"]);
    expect(scheduled.map((item) => item.id)).toContain("stuck");
  });

  test("post-run tab ignores expired lease", () => {
    expect(
      resolvePostRunStatusTab(
        { running: { expiresAt: now - 1 } },
        now,
      ),
    ).toBe("completed");
  });
});
