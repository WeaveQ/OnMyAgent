import { describe, expect, test } from "bun:test";

import {
  assertVersionMatch,
  isProcessAlive,
  parseVersion,
  resolveSelfCommand,
} from "../src/runtime-spawn";

describe("runtime-spawn", () => {
  test("isProcessAlive rejects invalid pids and accepts current process", () => {
    expect(isProcessAlive(undefined)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("parseVersion extracts semver tokens", () => {
    expect(parseVersion("opencode 1.17.20")).toBe("1.17.20");
    expect(parseVersion("v2.0.0-beta.1")).toBe("2.0.0-beta.1");
    expect(parseVersion("no version here")).toBeUndefined();
  });

  test("assertVersionMatch is a no-op without expected; throws on mismatch", () => {
    expect(() => assertVersionMatch("opencode", undefined, "1.0.0", "bin")).not.toThrow();
    expect(() => assertVersionMatch("opencode", "1.0.0", "1.0.0", "bin")).not.toThrow();
    expect(() => assertVersionMatch("opencode", "1.0.0", "1.0.1", "bin")).toThrow(/mismatch/);
    expect(() => assertVersionMatch("opencode", "1.0.0", undefined, "bin")).toThrow(/Unable to determine/);
  });

  test("resolveSelfCommand returns command and optional script prefix", () => {
    const self = resolveSelfCommand();
    expect(typeof self.command).toBe("string");
    expect(Array.isArray(self.prefixArgs)).toBe(true);
  });
});
