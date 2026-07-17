import { describe, expect, test } from "bun:test";

import {
  computerUseActivityTransition,
  computerUsePermissionTransition,
} from "../src/react-app/domains/shell-feedback/computer-use-activity-notifications";

describe("Computer Use activity notifications", () => {
  test("maps runtime phase transitions without notifying on initial state", () => {
    expect(computerUseActivityTransition(undefined, "ready")).toBeNull();
    expect(computerUseActivityTransition("ready", "running")).toBe("started");
    expect(computerUseActivityTransition("running", "paused")).toBe("paused");
    expect(computerUseActivityTransition("paused", "running")).toBe("resumed");
    expect(computerUseActivityTransition("running", "ready")).toBe("finished");
    expect(computerUseActivityTransition("running", "errored")).toBe("errored");
    expect(computerUseActivityTransition("ready", "ready")).toBeNull();
  });

  test("reports only permission loss after a known granted state", () => {
    const granted = { accessibility: true, screenRecording: true };
    expect(computerUsePermissionTransition(undefined, granted)).toBe(false);
    expect(computerUsePermissionTransition(granted, granted)).toBe(false);
    expect(computerUsePermissionTransition(granted, {
      accessibility: false,
      screenRecording: true,
    })).toBe(true);
  });
});
