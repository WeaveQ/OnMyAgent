import { describe, expect, test } from "bun:test";

import {
  isRejectedHomePath,
  resolveRealHomeDir,
} from "../src/services/real-home-policy.js";
import { resolveSessionArchiveHomeDir } from "../src/services/session-archive-registry.js";

describe("real-home-policy", () => {
  test("rejects sandbox and userData-looking homes", () => {
    expect(isRejectedHomePath("/x/opencode-sandbox/home")).toBe(true);
    expect(
      isRejectedHomePath(
        "/Users/alice/Library/Application Support/com.foo.onmyagent.dev/home",
      ),
    ).toBe(true);
    expect(isRejectedHomePath("/Volumes/Disk/alice")).toBe(false);
  });

  test("custom non-sandbox home wins over /Users/$USER", () => {
    expect(
      resolveRealHomeDir({
        home: "/Volumes/Disk/alice",
        user: "alice",
        platform: "darwin",
      }),
    ).toBe("/Volumes/Disk/alice");
  });

  test("sandbox override is not chosen", () => {
    expect(
      resolveRealHomeDir({
        override: "/x/opencode-sandbox/home",
        home: "/Volumes/Disk/alice",
        user: "alice",
        platform: "darwin",
      }),
    ).toBe("/Volumes/Disk/alice");
  });
});

describe("resolveSessionArchiveHomeDir", () => {
  test("sandbox ONMYAGENT_REAL_HOME is not returned", () => {
    const home = resolveSessionArchiveHomeDir({
      env: { ONMYAGENT_REAL_HOME: "/x/opencode-sandbox/home", USER: "alice" },
      homeDir: undefined,
    });
    expect(home).not.toBe("/x/opencode-sandbox/home");
    expect(home).not.toContain("opencode-sandbox");
    expect(home.length).toBeGreaterThan(0);
  });

  test("custom homeDir non-sandbox wins", () => {
    expect(
      resolveSessionArchiveHomeDir({
        homeDir: "/Volumes/Disk/alice",
        env: {
          ONMYAGENT_REAL_HOME: "/Users/alice",
          HOME: "/tmp/opencode-sandbox/home",
          USER: "alice",
        },
      }),
    ).toBe("/Volumes/Disk/alice");
  });

  test("sandbox homeDir falls through to a real env override", () => {
    expect(
      resolveSessionArchiveHomeDir({
        homeDir: "/x/opencode-sandbox/home",
        env: { ONMYAGENT_REAL_HOME: "/Volumes/Disk/alice", USER: "alice" },
      }),
    ).toBe("/Volumes/Disk/alice");
  });
});
