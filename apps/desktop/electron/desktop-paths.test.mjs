import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";

import { createDesktopPaths } from "./desktop-paths.mjs";

const previousOverride = process.env.ONMYAGENT_REAL_HOME;

afterEach(() => {
  if (previousOverride === undefined) delete process.env.ONMYAGENT_REAL_HOME;
  else process.env.ONMYAGENT_REAL_HOME = previousOverride;
});

describe("desktop path isolation", () => {
  test("uses an explicit absolute real-home override for disposable smoke state", () => {
    process.env.ONMYAGENT_REAL_HOME = "/tmp/onmyagent-isolated-home/../smoke-home";
    const paths = createDesktopPaths({ dirname: process.cwd() });

    expect(paths.getRealHomeDir()).toBe(path.resolve("/tmp/smoke-home"));
    expect(paths.userAgentRegistryPath()).toStartWith("/tmp/smoke-home/");
    expect(paths.onmyagentUserSkillsRoot()).toStartWith("/tmp/smoke-home/");
  });

  test("rejects a relative real-home override", () => {
    process.env.ONMYAGENT_REAL_HOME = "relative/home";
    const paths = createDesktopPaths({ dirname: process.cwd() });

    expect(() => paths.getRealHomeDir()).toThrow("must be an absolute path");
  });
});
