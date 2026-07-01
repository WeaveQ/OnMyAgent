import { describe, expect, test } from "bun:test";

import { compareVersions, isUpdateAllowedByDesktopConfig } from "../src/app/lib/version-gate";

describe("version gate", () => {
  test("compares semver releases and prereleases", () => {
    expect(compareVersions("0.13.3", "0.13.2")).toBe(1);
    expect(compareVersions("v0.13.3+build.1", "0.13.3")).toBe(0);
    expect(compareVersions("0.13.4-alpha.1", "0.13.4")).toBe(-1);
    expect(compareVersions("0.13.4-alpha.2", "0.13.4-alpha.1")).toBe(1);
    expect(compareVersions("0.13.x", "0.13.1")).toBeNull();
  });

  test("allows updates when no desktop config ceiling is present", () => {
    expect(isUpdateAllowedByDesktopConfig("0.13.3", null)).toBe(true);
    expect(isUpdateAllowedByDesktopConfig("0.13.3", {})).toBe(true);
  });

  test("requires exact allowed desktop version matches", () => {
    const desktopConfig = { allowedDesktopVersions: ["0.13.2", "0.13.3"] };

    expect(isUpdateAllowedByDesktopConfig("0.13.3", desktopConfig)).toBe(true);
    expect(isUpdateAllowedByDesktopConfig("v0.13.3+build.1", desktopConfig)).toBe(true);
    expect(isUpdateAllowedByDesktopConfig("0.13.4", desktopConfig)).toBe(false);
  });

  test("ignores invalid allowed desktop version entries", () => {
    const desktopConfig = { allowedDesktopVersions: ["latest", "0.13.3"] };

    expect(isUpdateAllowedByDesktopConfig("0.13.3", desktopConfig)).toBe(true);
    expect(isUpdateAllowedByDesktopConfig("latest", desktopConfig)).toBe(false);
  });
});
