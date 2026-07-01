import { afterEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import {
  resolveSandboxSidecarTarget,
  resolveSidecarBaseUrl,
  resolveSidecarConfig,
  resolveSidecarConfigForTarget,
  resolveSidecarDir,
  resolveSidecarManifestUrl,
  type SidecarConfigFlags,
} from "../src/sidecar-config.js";

const originalSidecarDir = process.env.ONMYAGENT_SIDECAR_DIR;
const originalBaseUrl = process.env.ONMYAGENT_SIDECAR_BASE_URL;
const originalManifestUrl = process.env.ONMYAGENT_SIDECAR_MANIFEST_URL;

function readFlag(flags: SidecarConfigFlags, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" ? value : undefined;
}

afterEach(() => {
  if (originalSidecarDir === undefined) delete process.env.ONMYAGENT_SIDECAR_DIR;
  else process.env.ONMYAGENT_SIDECAR_DIR = originalSidecarDir;
  if (originalBaseUrl === undefined) delete process.env.ONMYAGENT_SIDECAR_BASE_URL;
  else process.env.ONMYAGENT_SIDECAR_BASE_URL = originalBaseUrl;
  if (originalManifestUrl === undefined) delete process.env.ONMYAGENT_SIDECAR_MANIFEST_URL;
  else process.env.ONMYAGENT_SIDECAR_MANIFEST_URL = originalManifestUrl;
});

describe("sidecar config", () => {
  test("resolves sidecar dir from CLI before environment", () => {
    process.env.ONMYAGENT_SIDECAR_DIR = "/env/sidecars";
    const flags = new Map<string, string | boolean>([["sidecar-dir", " ./cli-sidecars "]]);

    expect(resolveSidecarDir(flags, readFlag)).toBe(resolve("./cli-sidecars"));
  });

  test("uses environment sidecar dir when CLI flag is absent", () => {
    process.env.ONMYAGENT_SIDECAR_DIR = " ./env-sidecars ";

    expect(resolveSidecarDir(new Map(), readFlag)).toBe(resolve("./env-sidecars"));
  });

  test("falls back to router data dir sidecars for blank overrides", () => {
    process.env.ONMYAGENT_SIDECAR_DIR = "   ";
    const flags = new Map<string, string | boolean>([
      ["data-dir", "./router-data"],
      ["sidecar-dir", "  "],
    ]);

    expect(resolveSidecarDir(flags, readFlag)).toBe(resolve("./router-data/sidecars"));
  });

  test("builds default release base URL from CLI version", () => {
    expect(resolveSidecarBaseUrl(new Map(), "0.1.2", readFlag)).toBe(
      "https://github.com/WeaveQ/onmyagent/releases/download/onmyagent-orchestrator-v0.1.2",
    );
  });

  test("uses trimmed environment base URL when CLI flag is absent", () => {
    process.env.ONMYAGENT_SIDECAR_BASE_URL = " https://downloads.example.test/env ";

    expect(resolveSidecarBaseUrl(new Map(), "0.1.2", readFlag)).toBe(
      "https://downloads.example.test/env",
    );
  });

  test("prefers CLI base URL over environment", () => {
    process.env.ONMYAGENT_SIDECAR_BASE_URL = "https://downloads.example.test/env";
    const flags = new Map<string, string | boolean>([
      ["sidecar-base-url", " https://downloads.example.test/cli "],
    ]);

    expect(resolveSidecarBaseUrl(flags, "0.1.2", readFlag)).toBe(
      "https://downloads.example.test/cli",
    );
  });

  test("trims manifest override and strips trailing slash for default manifest", () => {
    const flags = new Map<string, string | boolean>([["sidecar-manifest", " https://example.test/m.json "]]);

    expect(resolveSidecarManifestUrl(flags, "https://example.test/base/", readFlag)).toBe(
      "https://example.test/m.json",
    );
    expect(resolveSidecarManifestUrl(new Map(), "https://example.test/base/", readFlag)).toBe(
      "https://example.test/base/onmyagent-orchestrator-sidecars.json",
    );
  });

  test("uses environment manifest URL when CLI flag is absent", () => {
    process.env.ONMYAGENT_SIDECAR_MANIFEST_URL = " https://example.test/env-manifest.json ";

    expect(resolveSidecarManifestUrl(new Map(), "https://example.test/base", readFlag)).toBe(
      "https://example.test/env-manifest.json",
    );
  });

  test("prefers CLI manifest URL over environment", () => {
    process.env.ONMYAGENT_SIDECAR_MANIFEST_URL = "https://example.test/env-manifest.json";
    const flags = new Map<string, string | boolean>([
      ["sidecar-manifest", " https://example.test/cli-manifest.json "],
    ]);

    expect(resolveSidecarManifestUrl(flags, "https://example.test/base", readFlag)).toBe(
      "https://example.test/cli-manifest.json",
    );
  });

  test("uses linux sandbox target for sandboxed execution", () => {
    const target = resolveSandboxSidecarTarget("docker");
    expect(target === "linux-arm64" || target === "linux-x64" || target === null).toBe(true);
  });

  test("uses host target when sandboxing is disabled", () => {
    const target = resolveSandboxSidecarTarget("none");
    expect(
      target === "darwin-arm64" ||
        target === "darwin-x64" ||
        target === "linux-arm64" ||
        target === "linux-x64" ||
        target === "windows-arm64" ||
        target === "windows-x64" ||
        target === null,
    ).toBe(true);
  });

  test("composes sidecar config for an explicit target", () => {
    const flags = new Map<string, string | boolean>([
      ["sidecar-dir", "./sidecars"],
      ["sidecar-base-url", "https://downloads.example.test/pkg"],
    ]);

    expect(resolveSidecarConfigForTarget(flags, "9.9.9", "linux-x64", readFlag)).toEqual({
      dir: resolve("./sidecars"),
      baseUrl: "https://downloads.example.test/pkg",
      manifestUrl: "https://downloads.example.test/pkg/onmyagent-orchestrator-sidecars.json",
      target: "linux-x64",
    });
  });

  test("composes host-target sidecar config with manifest override", () => {
    const flags = new Map<string, string | boolean>([
      ["sidecar-dir", "./host-sidecars"],
      ["sidecar-base-url", "https://downloads.example.test/ignored"],
      ["sidecar-manifest", " https://downloads.example.test/manifest.json "],
    ]);

    const config = resolveSidecarConfig(flags, "1.2.3", readFlag);

    expect(config).toEqual({
      dir: resolve("./host-sidecars"),
      baseUrl: "https://downloads.example.test/ignored",
      manifestUrl: "https://downloads.example.test/manifest.json",
      target: resolveSandboxSidecarTarget("none"),
    });
  });

  test("preserves null target override in composed sidecar config", () => {
    const flags = new Map<string, string | boolean>([
      ["sidecar-dir", "./sidecars"],
      ["sidecar-base-url", " https://downloads.example.test/pkg/ "],
    ]);

    expect(resolveSidecarConfigForTarget(flags, "9.9.9", null, readFlag)).toEqual({
      dir: resolve("./sidecars"),
      baseUrl: "https://downloads.example.test/pkg/",
      manifestUrl: "https://downloads.example.test/pkg/onmyagent-orchestrator-sidecars.json",
      target: null,
    });
  });
});
