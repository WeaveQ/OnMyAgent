import { describe, expect, test } from "bun:test";

import {
  expertActivityLabel,
  isStreamingSessionStatus,
  pickAggregateSessionStatus,
} from "../src/react-app/domains/session/sidebar/utils";

describe("isStreamingSessionStatus", () => {
  test("accepts activity-store retrying (not only server retry)", () => {
    expect(isStreamingSessionStatus("retrying")).toBe(true);
    expect(isStreamingSessionStatus("retry")).toBe(true);
    expect(isStreamingSessionStatus("compacting")).toBe(true);
    expect(isStreamingSessionStatus("thinking")).toBe(true);
    expect(isStreamingSessionStatus("idle")).toBe(false);
    expect(isStreamingSessionStatus(undefined)).toBe(false);
  });
});

describe("expertActivityLabel", () => {
  test("maps retrying to 重试中 label key path", () => {
    const label = expertActivityLabel("retrying");
    expect(label).toBeTruthy();
    // Same copy path as main surface 重试中 (zh / en both non-empty).
    expect(label).toBe(expertActivityLabel("retry"));
  });

  test("maps compacting to a non-null busy label", () => {
    expect(expertActivityLabel("compacting")).toBeTruthy();
  });
});

describe("pickAggregateSessionStatus", () => {
  test("prefers responding over retrying over idle", () => {
    expect(
      pickAggregateSessionStatus(
        ["a", "b", "c"],
        { a: "idle", b: "retrying", c: "responding" },
      ),
    ).toBe("responding");
    expect(
      pickAggregateSessionStatus(["a", "b"], { a: "idle", b: "retrying" }),
    ).toBe("retrying");
  });
});
