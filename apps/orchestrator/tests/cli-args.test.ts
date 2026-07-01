import { describe, expect, test } from "bun:test";

import {
  parseArgs,
  parseList,
  readBinarySource,
  readBool,
  readFlag,
  readLogFormat,
  readNumber,
  readOpencodeHotReload,
  readOptionalBool,
  readSandboxMode,
} from "../src/cli-args";

describe("cli args", () => {
  test("parses positionals, short flags, inline values, values, and negated flags", () => {
    const parsed = parseArgs([
      "daemon",
      "--host=127.0.0.1",
      "--port",
      "8787",
      "--verbose",
      "--no-color",
      "-h",
      "-v",
    ]);

    expect(parsed.positionals).toEqual(["daemon"]);
    expect(parsed.flags.get("host")).toBe("127.0.0.1");
    expect(parsed.flags.get("port")).toBe("8787");
    expect(parsed.flags.get("verbose")).toBe(true);
    expect(parsed.flags.get("color")).toBe(false);
    expect(parsed.flags.get("help")).toBe(true);
    expect(parsed.flags.get("version")).toBe(true);
  });

  test("keeps following flag as a flag instead of a value", () => {
    const parsed = parseArgs(["--json", "--daemon-port", "9900"]);

    expect(parsed.flags.get("json")).toBe(true);
    expect(parsed.flags.get("daemon-port")).toBe("9900");
  });

  test("parses list values from csv, semicolon, json, and blank input", () => {
    expect(parseList("a,b; c")).toEqual(["a", "b", "c"]);
    expect(parseList('["a", 2, ""]')).toEqual(["a", "2"]);
    expect(parseList("[")).toEqual([]);
    expect(parseList("  ")).toEqual([]);
  });

  test("reads flag, bool, optional bool, and number values", () => {
    const flags = new Map<string, string | boolean>([
      ["enabled", "yes"],
      ["disabled", "0"],
      ["truthy", true],
      ["count", "42"],
      ["bad-count", "oops"],
    ]);

    expect(readFlag(flags, "truthy")).toBe("true");
    expect(readBool(flags, "enabled", false)).toBe(true);
    expect(readBool(flags, "disabled", true)).toBe(false);
    expect(readBool(flags, "missing", true)).toBe(true);
    expect(readOptionalBool("off")).toBe(false);
    expect(readOptionalBool("on")).toBe(true);
    expect(readOptionalBool("unknown")).toBeUndefined();
    expect(readNumber(flags, "count", 1)).toBe(42);
    expect(readNumber(flags, "bad-count", 1)).toBe(1);
  });

  test("normalizes constrained mode values", () => {
    expect(readBinarySource(new Map([["source", "bundled"]]), "source", "auto")).toBe("bundled");
    expect(readLogFormat(new Map([["format", "human"]]), "format", "json")).toBe("pretty");
    expect(readSandboxMode(new Map([["sandbox", "container"]]), "sandbox", "auto")).toBe("container");

    expect(() => readBinarySource(new Map([["source", "bad"]]), "source", "auto")).toThrow();
    expect(() => readLogFormat(new Map([["format", "xml"]]), "format", "pretty")).toThrow();
    expect(() => readSandboxMode(new Map([["sandbox", "vm"]]), "sandbox", "auto")).toThrow();
  });

  test("bounds opencode hot reload debounce and cooldown values", () => {
    const valid = readOpencodeHotReload(
      new Map<string, string | boolean>([
        ["opencode-hot-reload", "no"],
        ["opencode-hot-reload-debounce-ms", "75"],
        ["opencode-hot-reload-cooldown-ms", "250"],
      ]),
      { enabled: true, debounceMs: 700, cooldownMs: 1500 },
    );

    expect(valid).toEqual({ enabled: false, debounceMs: 75, cooldownMs: 250 });

    const clamped = readOpencodeHotReload(
      new Map<string, string | boolean>([
        ["opencode-hot-reload-debounce-ms", "20"],
        ["opencode-hot-reload-cooldown-ms", "50"],
      ]),
      { enabled: true, debounceMs: 700, cooldownMs: 1500 },
    );

    expect(clamped).toEqual({ enabled: true, debounceMs: 700, cooldownMs: 1500 });
  });
});
