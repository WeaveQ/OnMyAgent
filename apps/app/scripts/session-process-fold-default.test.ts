import { describe, expect, test } from "bun:test";

import {
  resolveProcessFoldExpandedAfterRunningChange,
  shouldDefaultExpandProcessFold,
} from "../src/react-app/domains/session/surface/message-list/process-fold";

describe("shouldDefaultExpandProcessFold (shipped)", () => {
  test("tool process chrome opens while running and starts collapsed when idle", () => {
    expect(
      shouldDefaultExpandProcessFold({ isPlanList: false, running: true }),
    ).toBe(true);
    expect(
      shouldDefaultExpandProcessFold({ isPlanList: false, running: false }),
    ).toBe(false);
  });

  test("plan/task list may open while running", () => {
    expect(
      shouldDefaultExpandProcessFold({ isPlanList: true, running: true }),
    ).toBe(true);
    expect(
      shouldDefaultExpandProcessFold({ isPlanList: true, running: false }),
    ).toBe(false);
  });

  test("running transitions open the process and terminal transitions collapse it", () => {
    expect(resolveProcessFoldExpandedAfterRunningChange({
      expanded: false,
      wasRunning: false,
      running: true,
    })).toBe(true);
    expect(resolveProcessFoldExpandedAfterRunningChange({
      expanded: true,
      wasRunning: true,
      running: false,
    })).toBe(false);
    expect(resolveProcessFoldExpandedAfterRunningChange({
      expanded: true,
      wasRunning: false,
      running: false,
    })).toBe(true);
  });
});
