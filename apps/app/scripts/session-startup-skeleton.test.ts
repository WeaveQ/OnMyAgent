import { describe, expect, test } from "bun:test";
import { shouldShowSessionStartupSkeleton } from "../src/react-app/domains/session/chat/session-page-model";

describe("shouldShowSessionStartupSkeleton", () => {
  test("false when workspace id known (settings return remount)", () => {
    expect(
      shouldShowSessionStartupSkeleton({
        selectedSessionId: null,
        selectedWorkspaceId: "ws_a",
        clientConnected: false,
        startupPhase: "nativeInit",
        coldBootShell: false,
      }),
    ).toBe(false);
  });

  test("true on cold boot even when workspace id is cache-hydrated", () => {
    expect(
      shouldShowSessionStartupSkeleton({
        selectedSessionId: null,
        selectedWorkspaceId: "ws_a",
        clientConnected: false,
        startupPhase: "nativeInit",
        coldBootShell: true,
      }),
    ).toBe(true);
  });

  test("false when session selected", () => {
    expect(
      shouldShowSessionStartupSkeleton({
        selectedSessionId: "ses_1",
        selectedWorkspaceId: "",
        clientConnected: false,
        startupPhase: "nativeInit",
        coldBootShell: true,
      }),
    ).toBe(false);
  });

  test("true only for true cold boot without workspace id", () => {
    expect(
      shouldShowSessionStartupSkeleton({
        selectedSessionId: null,
        selectedWorkspaceId: "",
        clientConnected: false,
        startupPhase: "nativeInit",
      }),
    ).toBe(true);
    expect(
      shouldShowSessionStartupSkeleton({
        selectedSessionId: null,
        selectedWorkspaceId: "",
        clientConnected: true,
        startupPhase: "nativeInit",
        coldBootShell: true,
      }),
    ).toBe(false);
    expect(
      shouldShowSessionStartupSkeleton({
        selectedSessionId: null,
        selectedWorkspaceId: "",
        clientConnected: false,
        startupPhase: "ready",
        coldBootShell: true,
      }),
    ).toBe(false);
  });
});
