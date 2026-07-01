import { describe, expect, test } from "bun:test";

import {
  looksLikeOtelLogLine,
  mergeResourceAttributes,
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
});
