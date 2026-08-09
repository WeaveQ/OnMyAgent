import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  BOOT_STATIC_HOME_DEADLINE_MS,
  planBootShellReadyAfterRefresh,
  shouldNotifyStaticHomeReady,
} from "../src/react-app/shell/session-route/boot-shell-ready";

describe("planBootShellReadyAfterRefresh", () => {
  test("marks immediately when not waiting for static home", () => {
    expect(planBootShellReadyAfterRefresh(false)).toEqual({
      type: "mark-immediately",
    });
  });

  test("schedules a hard deadline when waiting for static home paint", () => {
    expect(planBootShellReadyAfterRefresh(true)).toEqual({
      type: "wait-for-static-home",
      deadlineMs: BOOT_STATIC_HOME_DEADLINE_MS,
    });
    expect(BOOT_STATIC_HOME_DEADLINE_MS).toBeGreaterThan(0);
    expect(BOOT_STATIC_HOME_DEADLINE_MS).toBeLessThanOrEqual(5_000);
  });
});

describe("shouldNotifyStaticHomeReady", () => {
  test("releases latch for empty assistant home (null or empty session)", () => {
    expect(shouldNotifyStaticHomeReady(null)).toBe(true);
    expect(shouldNotifyStaticHomeReady(undefined)).toBe(true);
    expect(shouldNotifyStaticHomeReady("")).toBe(true);
  });

  test("does not release latch when a real session is selected", () => {
    expect(shouldNotifyStaticHomeReady("ses_abc")).toBe(false);
  });
});

describe("boot shell ready wiring (regression lock)", () => {
  test("refresh-hook applies plan + deadline timer (never hang without routeReady)", () => {
    const refresh = readFileSync(
      path.join(
        import.meta.dir,
        "../src/react-app/shell/session-route/refresh-hook.ts",
      ),
      "utf8",
    );
    expect(refresh).toContain("planBootShellReadyAfterRefresh");
    expect(refresh).toContain("staticHomeDeadlineTimerRef");
    expect(refresh).toContain('shellPlan.type === "mark-immediately"');
    expect(refresh).toContain("shellPlan.deadlineMs");
    // Must not unconditionally skip mark without a deadline path.
    expect(refresh).not.toContain(
      "if (!waitForStaticHomeFirstPaintRef.current) markShellReady();",
    );
  });

  test("assistant latch does not require isPrimarySessionView", () => {
    const assistant = readFileSync(
      path.join(
        import.meta.dir,
        "../src/react-app/domains/session/pages/assistant.tsx",
      ),
      "utf8",
    );
    expect(assistant).toContain("shouldNotifyStaticHomeReady");
    expect(assistant).toContain("props.onStaticHomeReady?.()");
    // Old gate hung cold starts on non-chat rails.
    expect(assistant).not.toContain(
      "if (!props.selectedSessionId && isPrimarySessionView)",
    );
  });

  test("boot overlay still requires routeReady (phase ready is copy-only)", () => {
    const bootState = readFileSync(
      path.join(import.meta.dir, "../src/react-app/shell/boot-state.tsx"),
      "utf8",
    );
    expect(bootState).toContain(
      'routeReady && !bootStillBlocking && phase !== "error"',
    );
    expect(bootState).toContain("hard deadline after route refresh");
  });
});
