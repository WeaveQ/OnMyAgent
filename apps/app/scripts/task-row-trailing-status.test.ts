import { describe, expect, test } from "bun:test";

import { resolveTaskRowTrailingStatus } from "../src/react-app/domains/session/sidebar/task-row-trailing-status";

describe("resolveTaskRowTrailingStatus", () => {
  test("selected + busy → busy (not time)", () => {
    const result = resolveTaskRowTrailingStatus({
      status: "busy",
      selected: true,
      unread: true,
      timeLabel: "12:55",
    });
    expect(result.kind).toBe("busy");
    expect(result.activityLabel).toBeTruthy();
    expect(result.timeLabel).toBe("12:55");
  });

  test("selected + unread + idle → time (not unread)", () => {
    const result = resolveTaskRowTrailingStatus({
      status: "idle",
      selected: true,
      unread: true,
      timeLabel: "07:16",
    });
    expect(result.kind).toBe("time");
    expect(result.timeLabel).toBe("07:16");
  });

  test("unselected + unread + idle → unread", () => {
    const result = resolveTaskRowTrailingStatus({
      status: undefined,
      selected: false,
      unread: true,
      timeLabel: "1天前",
    });
    expect(result.kind).toBe("unread");
  });

  test("unselected + busy → busy", () => {
    const result = resolveTaskRowTrailingStatus({
      status: "running",
      selected: false,
      unread: true,
      timeLabel: "12:00",
    });
    expect(result.kind).toBe("busy");
    expect(result.activityLabel).toBeTruthy();
  });

  test("waiting / retry / streaming count as busy", () => {
    for (const status of ["waiting", "retry", "streaming", "thinking", "responding"]) {
      const result = resolveTaskRowTrailingStatus({
        status,
        selected: true,
        timeLabel: "x",
      });
      expect(result.kind).toBe("busy");
    }
  });

  test("activity-store retrying/compacting count as busy (sidebar 重试中)", () => {
    for (const status of ["retrying", "compacting"]) {
      const result = resolveTaskRowTrailingStatus({
        status,
        selected: true,
        timeLabel: "12:55",
      });
      expect(result.kind).toBe("busy");
      expect(result.activityLabel).toBeTruthy();
    }
  });
});
