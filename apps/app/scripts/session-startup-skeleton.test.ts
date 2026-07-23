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
      }),
    ).toBe(false);
  });
  test("false when session selected", () => {
    expect(
      shouldShowSessionStartupSkeleton({
        selectedSessionId: "ses_1",
        selectedWorkspaceId: "",
        clientConnected: false,
        startupPhase: "nativeInit",
      }),
    ).toBe(false);
  });
  test("true only for true cold boot", () => {
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
      }),
    ).toBe(false);
    expect(
      shouldShowSessionStartupSkeleton({
        selectedSessionId: null,
        selectedWorkspaceId: "",
        clientConnected: false,
        startupPhase: "ready",
      }),
    ).toBe(false);
  });
});
