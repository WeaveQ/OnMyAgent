import { describe, expect, test } from "bun:test";

import { createDesktopPaths } from "./desktop-paths.mjs";
import { resolveAgentHostHome } from "./personal-agent-runtime/utils.mjs";
import { isRejectedHomePath, resolveRealHomeDir } from "./real-home-policy.mjs";

const previousOverride = process.env.ONMYAGENT_REAL_HOME;

function restoreRealHomeOverride() {
  if (previousOverride === undefined) delete process.env.ONMYAGENT_REAL_HOME;
  else process.env.ONMYAGENT_REAL_HOME = previousOverride;
}

describe("real-home-policy", () => {
  test("rejects opencode-sandbox and Application Support + onmyagent homes", () => {
    expect(isRejectedHomePath("/x/opencode-sandbox/home")).toBe(true);
    expect(
      isRejectedHomePath(
        "/Users/alice/Library/Application Support/com.foo.onmyagent.dev/home",
      ),
    ).toBe(true);
    expect(isRejectedHomePath("/Users/alice/Library/Application Support/Mail")).toBe(false);
    expect(isRejectedHomePath("/Volumes/Disk/alice")).toBe(false);
    expect(isRejectedHomePath("")).toBe(false);
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

  test("custom non-sandbox home wins over /Users/$USER", () => {
    expect(
      resolveRealHomeDir({
        home: "/Volumes/Disk/alice",
        user: "alice",
        platform: "darwin",
      }),
    ).toBe("/Volumes/Disk/alice");
  });

  test("last-resort /Users/$USER only when known home is sandbox", () => {
    expect(
      resolveRealHomeDir({
        override: "/tmp/opencode-sandbox/home",
        home: "/Library/Application Support/onmyagent/home",
        user: "alice",
        platform: "darwin",
      }),
    ).toBe("/Users/alice");
  });

  test("win32 prefers USERPROFILE after a sandbox home", () => {
    expect(
      resolveRealHomeDir({
        home: "C:\\Users\\alice\\AppData\\opencode-sandbox\\home",
        userProfile: "D:\\alice",
        user: "alice",
        platform: "win32",
      }),
    ).toBe("D:\\alice");
  });
});

describe("getRealHomeDir via policy", () => {
  test("override containing opencode-sandbox is not chosen", () => {
    process.env.ONMYAGENT_REAL_HOME = "/tmp/x/opencode-sandbox/home";
    try {
      const home = createDesktopPaths({ dirname: process.cwd() }).getRealHomeDir();
      expect(home).not.toContain("opencode-sandbox");
      expect(home.length).toBeGreaterThan(0);
    } finally {
      restoreRealHomeOverride();
    }
  });
});

describe("resolveAgentHostHome via policy", () => {
  test("sandbox ONMYAGENT_REAL_HOME falls through to custom HOME", () => {
    expect(
      resolveAgentHostHome({
        ONMYAGENT_REAL_HOME: "/x/opencode-sandbox/home",
        HOME: "/Volumes/Disk/alice",
        USER: "alice",
      }),
    ).toBe("/Volumes/Disk/alice");
  });

  test("Application Support onmyagent HOME is not treated as real", () => {
    const home = resolveAgentHostHome({
      ONMYAGENT_REAL_HOME: "/Users/alice/Library/Application Support/onmyagent/home",
      HOME: "/Users/alice/Library/Application Support/onmyagent/home",
      USER: "alice",
    });
    expect(home).not.toContain("Application Support");
    expect(home).not.toContain("opencode-sandbox");
  });
});
