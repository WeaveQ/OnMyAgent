import { afterEach, describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";

import { resolveRouterDataDir, type DataDirFlags } from "../src/data-dir.js";

const originalDataDir = process.env.ONMYAGENT_DATA_DIR;

function readFlag(flags: DataDirFlags, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

afterEach(() => {
  if (originalDataDir === undefined) {
    delete process.env.ONMYAGENT_DATA_DIR;
  } else {
    process.env.ONMYAGENT_DATA_DIR = originalDataDir;
  }
});

describe("resolveRouterDataDir", () => {
  test("prefers CLI data-dir over environment", () => {
    process.env.ONMYAGENT_DATA_DIR = "/env/data";
    const flags = new Map<string, string | boolean>([["data-dir", " ./local-data "]]);

    expect(resolveRouterDataDir(flags, readFlag)).toBe(resolve("./local-data"));
  });

  test("uses ONMYAGENT_DATA_DIR when CLI flag is absent", () => {
    process.env.ONMYAGENT_DATA_DIR = " ./env-data ";

    expect(resolveRouterDataDir(new Map(), readFlag)).toBe(resolve("./env-data"));
  });

  test("ignores non-string CLI data-dir flags", () => {
    process.env.ONMYAGENT_DATA_DIR = " ./env-data ";
    const flags = new Map<string, string | boolean>([["data-dir", true]]);

    expect(resolveRouterDataDir(flags, readFlag)).toBe(resolve("./env-data"));
  });

  test("ignores blank CLI and environment overrides", () => {
    process.env.ONMYAGENT_DATA_DIR = "   ";
    const flags = new Map<string, string | boolean>([["data-dir", "  "]]);

    expect(resolveRouterDataDir(flags, readFlag)).toContain(
      join(".onmyagent", "onmyagent-orchestrator"),
    );
  });

  test("falls back to the default onmyagent orchestrator directory", () => {
    delete process.env.ONMYAGENT_DATA_DIR;

    expect(resolveRouterDataDir(new Map(), readFlag)).toContain(
      join(".onmyagent", "onmyagent-orchestrator"),
    );
  });
});
