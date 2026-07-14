import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { buildSpawnEnv, loadUserEnvFile, resolveUserEnvFilePath } from "../src/env-paths.js";

const originalEnvStore = process.env.ONMYAGENT_ENV_STORE;
// OPENWRK_* is legacy; tracked separately so dual-read fallback tests stay isolated.
const originalLegacyOpenwrkSidecarDir = process.env.OPENWRK_SIDECAR_DIR;
const originalOnMyAgentSidecarDir = process.env.ONMYAGENT_SIDECAR_DIR;

afterEach(() => {
  if (originalEnvStore === undefined) delete process.env.ONMYAGENT_ENV_STORE;
  else process.env.ONMYAGENT_ENV_STORE = originalEnvStore;
  if (originalLegacyOpenwrkSidecarDir === undefined) delete process.env.OPENWRK_SIDECAR_DIR;
  else process.env.OPENWRK_SIDECAR_DIR = originalLegacyOpenwrkSidecarDir;
  if (originalOnMyAgentSidecarDir === undefined) delete process.env.ONMYAGENT_SIDECAR_DIR;
  else process.env.ONMYAGENT_SIDECAR_DIR = originalOnMyAgentSidecarDir;
});

describe("env paths", () => {
  test("resolveUserEnvFilePath honors ONMYAGENT_ENV_STORE", () => {
    process.env.ONMYAGENT_ENV_STORE = " ./custom-env.json ";

    expect(resolveUserEnvFilePath()).toContain("custom-env.json");
  });

  test("loadUserEnvFile filters invalid and reserved variables", () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-orch-env-"));
    const path = join(dir, "env.json");
    process.env.ONMYAGENT_ENV_STORE = path;
    writeFileSync(
      path,
      JSON.stringify({
        variables: [
          { key: "ANTHROPIC_API_KEY", value: "sk-test" },
          { key: "ONMYAGENT_TOKEN", value: "blocked" },
          { key: "bad-key", value: "blocked" },
          { key: "NUMERIC", value: 123 },
        ],
      }),
    );

    try {
      expect(loadUserEnvFile()).toEqual({ ANTHROPIC_API_KEY: "sk-test" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loadUserEnvFile accepts underscores and later duplicate keys win", () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-orch-env-"));
    const path = join(dir, "env.json");
    process.env.ONMYAGENT_ENV_STORE = path;
    writeFileSync(
      path,
      JSON.stringify({
        variables: [
          { key: "_LEADING_UNDERSCORE", value: "ok" },
          { key: "DUPLICATE_KEY", value: "old" },
          { key: "DUPLICATE_KEY", value: "new" },
          { key: "OPENCODE_TOKEN", value: "blocked" },
          null,
        ],
      }),
    );

    try {
      expect(loadUserEnvFile()).toEqual({
        _LEADING_UNDERSCORE: "ok",
        DUPLICATE_KEY: "new",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("loadUserEnvFile returns empty env for missing or malformed stores", () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-orch-env-"));
    const path = join(dir, "env.json");
    process.env.ONMYAGENT_ENV_STORE = path;

    try {
      expect(loadUserEnvFile()).toEqual({});
      writeFileSync(path, "not-json");
      expect(loadUserEnvFile()).toEqual({});
      writeFileSync(path, JSON.stringify({ variables: { key: "VALUE" } }));
      expect(loadUserEnvFile()).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("buildSpawnEnv overlays process env over user env and preserves Path key", () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-orch-env-"));
    const path = join(dir, "env.json");
    process.env.ONMYAGENT_ENV_STORE = path;
    writeFileSync(path, JSON.stringify({ variables: [{ key: "FROM_FILE", value: "file" }] }));

    try {
      const env = buildSpawnEnv(
        { Path: ["/existing/bin", "/another/bin"].join(delimiter), FROM_FILE: "override" },
        { orchestratorRoot: dir, repoRoot: dir },
      );

      expect(env.FROM_FILE).toBe("override");
      expect(env.Path).toContain("/existing/bin");
      expect(env.PATH).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("buildSpawnEnv uses PATH when both PATH and Path are present", () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-orch-env-"));
    const path = join(dir, "env.json");
    process.env.ONMYAGENT_ENV_STORE = path;
    writeFileSync(path, JSON.stringify({ variables: [{ key: "FROM_FILE", value: "file" }] }));

    try {
      const env = buildSpawnEnv(
        { PATH: "/posix/bin", Path: "/windows/bin" },
        { orchestratorRoot: dir, repoRoot: dir },
      );

      expect(env.PATH).toContain("/posix/bin");
      expect(env.Path).toBe("/windows/bin");
      expect(env.FROM_FILE).toBe("file");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("buildSpawnEnv prepends managed sidecar paths and dedupes inherited PATH", () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-orch-path-"));
    const sidecarDir = join(dir, "sidecars");
    const inheritedBin = join(dir, "bin");
    process.env.ONMYAGENT_SIDECAR_DIR = sidecarDir;
    rmSync(sidecarDir, { recursive: true, force: true });
    rmSync(inheritedBin, { recursive: true, force: true });

    try {
      writeFileSync(join(dir, "placeholder"), "ok");
      mkdirSync(sidecarDir, { recursive: true });
      mkdirSync(inheritedBin, { recursive: true });
      const env = buildSpawnEnv(
        { PATH: [sidecarDir, inheritedBin, sidecarDir].join(delimiter) },
        { orchestratorRoot: join(dir, "orchestrator"), repoRoot: join(dir, "repo") },
      );
      const entries = env.PATH?.split(delimiter) ?? [];

      expect(entries[0]).toBe(sidecarDir);
      expect(entries).toContain(inheritedBin);
      expect(entries.filter((entry) => entry === sidecarDir)).toHaveLength(1);
      expect(entries.filter((entry) => entry === inheritedBin)).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("buildSpawnEnv prefers ONMYAGENT_SIDECAR_DIR over legacy OPENWRK_SIDECAR_DIR", () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-orch-path-"));
    const legacySidecarDir = join(dir, "legacy-sidecars");
    const onMyAgentSidecarDir = join(dir, "onmyagent-sidecars");
    process.env.OPENWRK_SIDECAR_DIR = legacySidecarDir;
    process.env.ONMYAGENT_SIDECAR_DIR = onMyAgentSidecarDir;
    mkdirSync(legacySidecarDir, { recursive: true });
    mkdirSync(onMyAgentSidecarDir, { recursive: true });

    try {
      const env = buildSpawnEnv(
        { PATH: "" },
        { orchestratorRoot: join(dir, "orchestrator"), repoRoot: join(dir, "repo") },
      );
      const entries = env.PATH?.split(delimiter) ?? [];
      expect(entries[0]).toBe(onMyAgentSidecarDir);
      expect(entries).not.toContain(legacySidecarDir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("buildSpawnEnv falls back to legacy OPENWRK_SIDECAR_DIR when ONMYAGENT_SIDECAR_DIR is unset", () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-orch-path-"));
    const legacySidecarDir = join(dir, "legacy-sidecars");
    process.env.OPENWRK_SIDECAR_DIR = legacySidecarDir;
    delete process.env.ONMYAGENT_SIDECAR_DIR;
    mkdirSync(legacySidecarDir, { recursive: true });

    try {
      const env = buildSpawnEnv(
        { PATH: "" },
        { orchestratorRoot: join(dir, "orchestrator"), repoRoot: join(dir, "repo") },
      );
      const entries = env.PATH?.split(delimiter) ?? [];
      expect(entries[0]).toBe(legacySidecarDir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
