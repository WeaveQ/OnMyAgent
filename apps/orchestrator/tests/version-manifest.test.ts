import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readVersionManifest } from "../src/version-manifest.js";

const originalManifest = process.env.ONMYAGENT_VERSION_MANIFEST;
const originalBundledSidecarDir = process.env.ONMYAGENT_BUNDLED_SIDECAR_DIR;
const originalExecPath = process.execPath;

afterEach(() => {
  if (originalManifest === undefined) delete process.env.ONMYAGENT_VERSION_MANIFEST;
  else process.env.ONMYAGENT_VERSION_MANIFEST = originalManifest;
  if (originalBundledSidecarDir === undefined) delete process.env.ONMYAGENT_BUNDLED_SIDECAR_DIR;
  else process.env.ONMYAGENT_BUNDLED_SIDECAR_DIR = originalBundledSidecarDir;
  Object.defineProperty(process, "execPath", { value: originalExecPath, configurable: true });
});

function setExecPath(path: string): void {
  Object.defineProperty(process, "execPath", { value: path, configurable: true });
}

describe("readVersionManifest", () => {
  test("reads an explicit environment manifest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-version-"));
    const manifestPath = join(dir, "versions.json");
    process.env.ONMYAGENT_VERSION_MANIFEST = manifestPath;
    writeFileSync(
      manifestPath,
      JSON.stringify({ "onmyagent-server": { version: "1.2.3", sha256: "abc" } }),
    );

    try {
      expect(await readVersionManifest()).toEqual({
        dir,
        entries: { "onmyagent-server": { version: "1.2.3", sha256: "abc" } },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uses bundled sidecar dir for explicit manifest when provided", async () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-version-"));
    const sidecarDir = join(dir, "sidecars");
    const manifestPath = join(dir, "versions.json");
    process.env.ONMYAGENT_VERSION_MANIFEST = manifestPath;
    process.env.ONMYAGENT_BUNDLED_SIDECAR_DIR = sidecarDir;
    writeFileSync(manifestPath, JSON.stringify({}));

    try {
      expect(await readVersionManifest()).toEqual({ dir: sidecarDir, entries: {} });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uses explicit manifest directory when bundled sidecar dir is blank", async () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-version-"));
    const manifestDir = join(dir, "manifest");
    const manifestPath = join(manifestDir, "versions.json");
    mkdirSync(manifestDir, { recursive: true });
    process.env.ONMYAGENT_VERSION_MANIFEST = ` ${manifestPath} `;
    process.env.ONMYAGENT_BUNDLED_SIDECAR_DIR = "   ";
    writeFileSync(manifestPath, JSON.stringify({ explicit: { version: "4.0.0", sha256: "jkl" } }));

    try {
      expect(await readVersionManifest()).toEqual({
        dir: manifestDir,
        entries: { explicit: { version: "4.0.0", sha256: "jkl" } },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns an empty manifest for invalid JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-version-"));
    const manifestPath = join(dir, "versions.json");
    process.env.ONMYAGENT_VERSION_MANIFEST = manifestPath;
    writeFileSync(manifestPath, "not-json");

    try {
      expect(await readVersionManifest()).toEqual({ dir, entries: {} });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("returns null when no candidate manifest exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-version-"));
    const binDir = join(dir, "bin");
    mkdirSync(binDir, { recursive: true });
    delete process.env.ONMYAGENT_VERSION_MANIFEST;
    delete process.env.ONMYAGENT_BUNDLED_SIDECAR_DIR;
    setExecPath(join(binDir, "onmyagent"));

    try {
      expect(await readVersionManifest()).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("ignores blank explicit manifest path and falls back to binary manifest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-version-"));
    const binDir = join(dir, "bin");
    mkdirSync(binDir, { recursive: true });
    process.env.ONMYAGENT_VERSION_MANIFEST = "   ";
    process.env.ONMYAGENT_BUNDLED_SIDECAR_DIR = join(dir, "ignored-sidecars");
    setExecPath(join(binDir, "onmyagent"));
    writeFileSync(join(binDir, "versions.json"), JSON.stringify({ binary: { version: "5", sha256: "bin" } }));

    try {
      expect(await readVersionManifest()).toEqual({
        dir: binDir,
        entries: { binary: { version: "5", sha256: "bin" } },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reads the manifest next to the running binary", async () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-version-"));
    const binDir = join(dir, "bin");
    mkdirSync(binDir, { recursive: true });
    delete process.env.ONMYAGENT_VERSION_MANIFEST;
    process.env.ONMYAGENT_BUNDLED_SIDECAR_DIR = join(dir, "ignored-sidecars");
    setExecPath(join(binDir, "onmyagent"));
    writeFileSync(
      join(binDir, "versions.json"),
      JSON.stringify({ "onmyagent-orchestrator": { version: "2.0.0", sha256: "def" } }),
    );

    try {
      expect(await readVersionManifest()).toEqual({
        dir: binDir,
        entries: { "onmyagent-orchestrator": { version: "2.0.0", sha256: "def" } },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("prefers explicit manifest over binary-adjacent manifest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-version-"));
    const binDir = join(dir, "bin");
    const envDir = join(dir, "env");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(envDir, { recursive: true });
    process.env.ONMYAGENT_VERSION_MANIFEST = join(envDir, "versions.json");
    setExecPath(join(binDir, "onmyagent"));
    writeFileSync(join(binDir, "versions.json"), JSON.stringify({ binary: { version: "1", sha256: "bin" } }));
    writeFileSync(
      process.env.ONMYAGENT_VERSION_MANIFEST,
      JSON.stringify({ explicit: { version: "2", sha256: "env" } }),
    );

    try {
      expect(await readVersionManifest()).toEqual({
        dir: envDir,
        entries: { explicit: { version: "2", sha256: "env" } },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("reads packaged resources manifest after binary-adjacent miss", async () => {
    const dir = mkdtempSync(join(tmpdir(), "onmyagent-version-"));
    const binDir = join(dir, "MacOS");
    const resourcesDir = join(dir, "Resources");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(resourcesDir, { recursive: true });
    delete process.env.ONMYAGENT_VERSION_MANIFEST;
    delete process.env.ONMYAGENT_BUNDLED_SIDECAR_DIR;
    setExecPath(join(binDir, "OnMyAgent"));
    writeFileSync(
      join(resourcesDir, "versions.json"),
      JSON.stringify({ "onmyagent-server": { version: "3.0.0", sha256: "ghi" } }),
    );

    try {
      expect(await readVersionManifest()).toEqual({
        dir: binDir,
        entries: { "onmyagent-server": { version: "3.0.0", sha256: "ghi" } },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
