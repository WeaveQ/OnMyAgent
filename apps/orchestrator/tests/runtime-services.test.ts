import { describe, expect, test } from "bun:test";

import {
  buildOnMyAgentServerRuntimeEnv,
  looksLikeOtelLogLine,
  mergeResourceAttributes,
  resolvePrimaryOpencodeRuntimeIdentity,
  resolveBinCommand,
  shouldUseBun,
} from "../src/runtime-services";

describe("runtime services", () => {
  test("resolves node, bun, and direct binary commands", () => {
    expect(resolveBinCommand("src/index.ts")).toEqual({
      command: "bun",
      prefixArgs: ["src/index.ts", "--"],
    });
    expect(resolveBinCommand("tools/other.js")).toEqual({
      command: "node",
      prefixArgs: ["tools/other.js", "--"],
    });
    expect(resolveBinCommand("/usr/local/bin/opencode")).toEqual({
      command: "/usr/local/bin/opencode",
      prefixArgs: [],
    });
  });

  test("uses bun for onmyagent server JavaScript entrypoints only", () => {
    expect(shouldUseBun("apps/server/dist/cli.js")).toBe(false);
    expect(shouldUseBun("node_modules/onmyagent-server/dist/cli.js")).toBe(true);
    expect(shouldUseBun("packages/server/dist/cli.js")).toBe(true);
  });

  test("merges resource attributes with stable override and comma escaping", () => {
    expect(
      mergeResourceAttributes(
        { "service.name": "opencode", "service.instance.id": "run,1" },
        "service.name=old,env=dev,broken",
      ),
    ).toBe("service.name=opencode,env=dev,service.instance.id=run;1");
  });

  test("detects OpenTelemetry JSON log lines", () => {
    expect(
      looksLikeOtelLogLine(
        JSON.stringify({ timeUnixNano: "1", severityText: "INFO" }),
      ),
    ).toBe(true);
    expect(looksLikeOtelLogLine('{"severityText":"INFO"}')).toBe(false);
    expect(looksLikeOtelLogLine("not-json")).toBe(false);
  });

  test("injects the resolved orchestrator data root into the server process", () => {
    expect(buildOnMyAgentServerRuntimeEnv({
      dataDir: "C:\\Users\\fixture\\OnMyAgent Data",
      opencodeRuntimeIdentity: {
        profileId: "orchestrator-system",
        runtimeHome: "C:\\Users\\fixture\\.local\\share\\opencode",
        sandboxProfile: "fixture-sandbox",
      },
      token: "client-token",
      hostToken: "host-token",
      runId: "run-id",
      logFormat: "json",
    })).toEqual({
      ONMYAGENT_PRIMARY_RUNTIME_DATA_ROOT:
        "C:\\Users\\fixture\\OnMyAgent Data",
      ONMYAGENT_PRIMARY_OPENCODE_PROFILE_ID: "orchestrator-system",
      ONMYAGENT_PRIMARY_OPENCODE_RUNTIME_HOME:
        "C:\\Users\\fixture\\.local\\share\\opencode",
      ONMYAGENT_PRIMARY_OPENCODE_SANDBOX_PROFILE: "fixture-sandbox",
      ONMYAGENT_TOKEN: "client-token",
      ONMYAGENT_HOST_TOKEN: "host-token",
      ONMYAGENT_RUN_ID: "run-id",
      ONMYAGENT_LOG_FORMAT: "json",
    });
  });

  test("resolves the isolated dev OpenCode identity from its exact state layout", () => {
    expect(resolvePrimaryOpencodeRuntimeIdentity({
      stateLayout: {
        devMode: true,
        rootDir: "/data/onmyagent-dev-data",
        configDir: "/data/onmyagent-dev-data/config/opencode",
        env: { XDG_DATA_HOME: "/data/onmyagent-dev-data/xdg/data" },
      },
      environment: {},
      platform: "linux",
      homeDir: "/unused",
    })).toEqual({
      profileId: "orchestrator-dev",
      runtimeHome: "/data/onmyagent-dev-data/xdg/data/opencode",
    });
  });

  test.each([
    ["darwin", "/Users/fixture", "/Users/fixture/.local/share/opencode"],
    ["linux", "/home/fixture", "/home/fixture/.local/share/opencode"],
    ["win32", "C:\\Users\\fixture", "C:\\Users\\fixture\\.local\\share\\opencode"],
  ] as const)("matches OpenCode xdg-basedir fallback on %s", (platform, homeDir, runtimeHome) => {
    expect(resolvePrimaryOpencodeRuntimeIdentity({
      stateLayout: {
        devMode: false,
        rootDir: "/config",
        configDir: "/config",
        env: {},
      },
      environment: { APPDATA: "C:\\Users\\fixture\\AppData\\Roaming" },
      platform,
      homeDir,
    })).toEqual({
      profileId: "orchestrator-system",
      runtimeHome,
    });
  });

  test("prefers the state-layout XDG data root over the host environment", () => {
    expect(resolvePrimaryOpencodeRuntimeIdentity({
      stateLayout: {
        devMode: false,
        rootDir: "/config",
        configDir: "/config",
        env: { XDG_DATA_HOME: "/layout/data" },
      },
      environment: { XDG_DATA_HOME: "/host/data" },
      platform: "linux",
      homeDir: "/home/fixture",
    }).runtimeHome).toBe("/layout/data/opencode");
  });
});
