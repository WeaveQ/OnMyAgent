import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resolveHostOpencodeGlobalConfigDir,
  resolveHostOpencodeGlobalDataDir,
  resolveSandboxExtraMounts,
} from "../src/sandbox-mounts.js";

const originalAllowlist = process.env.ONMYAGENT_SANDBOX_MOUNT_ALLOWLIST;
const originalMountOpencodeConfig = process.env.ONMYAGENT_SANDBOX_MOUNT_OPENCODE_CONFIG;
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
const originalXdgDataHome = process.env.XDG_DATA_HOME;

function withAllowlist(allowlist: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "onmyagent-sandbox-mounts-"));
  const allowlistPath = join(dir, "allowlist.json");
  writeFileSync(allowlistPath, JSON.stringify(allowlist));
  process.env.ONMYAGENT_SANDBOX_MOUNT_ALLOWLIST = allowlistPath;
  return { dir, allowlistPath };
}

afterEach(() => {
  if (originalAllowlist === undefined) delete process.env.ONMYAGENT_SANDBOX_MOUNT_ALLOWLIST;
  else process.env.ONMYAGENT_SANDBOX_MOUNT_ALLOWLIST = originalAllowlist;
  if (originalMountOpencodeConfig === undefined) delete process.env.ONMYAGENT_SANDBOX_MOUNT_OPENCODE_CONFIG;
  else process.env.ONMYAGENT_SANDBOX_MOUNT_OPENCODE_CONFIG = originalMountOpencodeConfig;
  if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
  if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalXdgDataHome;
});

describe("opencode sandbox global config/data dirs", () => {
  test("keeps global opencode config disabled by default in dev mode", async () => {
    const root = mkdtempSync(join(tmpdir(), "onmyagent-opencode-config-"));
    process.env.XDG_CONFIG_HOME = root;
    mkdirSync(join(root, "opencode"), { recursive: true });
    writeFileSync(join(root, "opencode", "opencode.jsonc"), "{}");

    try {
      expect(await resolveHostOpencodeGlobalConfigDir({ devMode: true })).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("finds XDG opencode config when mounting is explicitly enabled", async () => {
    const root = mkdtempSync(join(tmpdir(), "onmyagent-opencode-config-"));
    const configDir = join(root, "opencode");
    process.env.XDG_CONFIG_HOME = root;
    process.env.ONMYAGENT_SANDBOX_MOUNT_OPENCODE_CONFIG = "1";
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "AGENTS.md"), "# ok");

    try {
      expect(await resolveHostOpencodeGlobalConfigDir({ devMode: true })).toBe(configDir);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("falls back to non-empty opencode config directories", async () => {
    const root = mkdtempSync(join(tmpdir(), "onmyagent-opencode-config-"));
    const configDir = join(root, "opencode");
    process.env.XDG_CONFIG_HOME = root;
    process.env.ONMYAGENT_SANDBOX_MOUNT_OPENCODE_CONFIG = "1";
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "provider-auth.json"), "{}");

    try {
      expect(await resolveHostOpencodeGlobalConfigDir({ devMode: true })).toBe(configDir);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("prefers XDG opencode data dir when auth material exists", async () => {
    const root = mkdtempSync(join(tmpdir(), "onmyagent-opencode-data-"));
    const dataDir = join(root, "opencode");
    process.env.XDG_DATA_HOME = root;
    process.env.ONMYAGENT_SANDBOX_MOUNT_OPENCODE_CONFIG = "1";
    mkdirSync(dataDir, { recursive: true });

    try {
      writeFileSync(join(dataDir, "auth.json"), "{}");
      expect(await resolveHostOpencodeGlobalDataDir({ devMode: true })).toBe(dataDir);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("resolveSandboxExtraMounts", () => {
  test("keeps read-only mounts read-only under read-only allowlist roots", async () => {
    const root = mkdtempSync(join(tmpdir(), "onmyagent-sandbox-root-"));
    const workspace = join(root, "workspace");
    writeFileSync(join(root, "placeholder"), "ok");
    const { dir } = withAllowlist({
      allowedRoots: [{ path: root, allowReadWrite: false }],
    });

    try {
      const realRoot = await realpath(root);
      const mounts = await resolveSandboxExtraMounts([`${root}:project:rw`], "docker");
      expect(mounts).toEqual([
        {
          hostPath: realRoot,
          containerPath: "/workspace/extra/project",
          readonly: true,
        },
      ]);
      expect(workspace.endsWith("workspace")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects unsafe container subpaths before creating mounts", async () => {
    const root = mkdtempSync(join(tmpdir(), "onmyagent-sandbox-root-"));
    const { dir } = withAllowlist({
      allowedRoots: [{ path: root, allowReadWrite: true }],
    });

    try {
      await expect(resolveSandboxExtraMounts([`${root}:../escape:ro`], "docker")).rejects.toThrow(
        "Invalid sandbox container subpath",
      );
      await expect(resolveSandboxExtraMounts([`${root}:/absolute:ro`], "docker")).rejects.toThrow(
        "Invalid sandbox container subpath",
      );
      await expect(resolveSandboxExtraMounts([`${root}:nested\\windows:ro`], "docker")).rejects.toThrow(
        "Invalid sandbox container subpath",
      );
      await expect(resolveSandboxExtraMounts([`${root}:.:ro`], "docker")).rejects.toThrow(
        "Invalid sandbox container subpath",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("allows read-write mounts only when the matched root permits them", async () => {
    const root = mkdtempSync(join(tmpdir(), "onmyagent-sandbox-root-"));
    const { dir } = withAllowlist({
      allowedRoots: [{ path: root, allowReadWrite: true }],
    });

    try {
      const realRoot = await realpath(root);
      await expect(resolveSandboxExtraMounts([`${root}:project:rw`], "docker"))
        .resolves.toEqual([
          {
            hostPath: realRoot,
            containerPath: "/workspace/extra/project",
            readonly: false,
          },
        ]);
      await expect(resolveSandboxExtraMounts([`${root}:project:ro`], "docker"))
        .resolves.toEqual([
          {
            hostPath: realRoot,
            containerPath: "/workspace/extra/project",
            readonly: true,
          },
        ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("uses read-write mode by default when the allowed root permits writes", async () => {
    const root = mkdtempSync(join(tmpdir(), "onmyagent-sandbox-root-"));
    const { dir } = withAllowlist({
      allowedRoots: [{ path: root, allowReadWrite: true }],
    });

    try {
      const realRoot = await realpath(root);
      await expect(resolveSandboxExtraMounts([`${root}:project`], "docker"))
        .resolves.toEqual([
          {
            hostPath: realRoot,
            containerPath: "/workspace/extra/project",
            readonly: false,
          },
        ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects malformed mount specs before resolving host paths", async () => {
    const root = mkdtempSync(join(tmpdir(), "onmyagent-sandbox-root-"));
    const { dir } = withAllowlist({
      allowedRoots: [{ path: root, allowReadWrite: true }],
    });

    try {
      await expect(resolveSandboxExtraMounts([""], "docker"))
        .rejects.toThrow("Empty --sandbox-mount entry");
      await expect(resolveSandboxExtraMounts([`${root}:ro`], "docker"))
        .rejects.toThrow("Invalid --sandbox-mount value");
      await expect(resolveSandboxExtraMounts([`${root}:`], "docker"))
        .rejects.toThrow("Invalid --sandbox-mount value");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects host paths outside the configured allowlist", async () => {
    const allowedRoot = mkdtempSync(join(tmpdir(), "onmyagent-sandbox-allowed-"));
    const outsideRoot = mkdtempSync(join(tmpdir(), "onmyagent-sandbox-outside-"));
    const { dir } = withAllowlist({
      allowedRoots: [{ path: allowedRoot, allowReadWrite: true }],
    });

    try {
      await expect(resolveSandboxExtraMounts([`${outsideRoot}:outside:ro`], "docker"))
        .rejects.toThrow("is not under any allowed root");
    } finally {
      rmSync(allowedRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rejects blocked host path patterns before allowlist matching", async () => {
    const root = mkdtempSync(join(tmpdir(), "onmyagent-sandbox-root-"));
    const secretDir = join(root, ".ssh");
    const { dir } = withAllowlist({
      allowedRoots: [{ path: root, allowReadWrite: true }],
    });

    try {
      writeFileSync(join(root, "placeholder"), "ok");
      mkdirSync(secretDir, { recursive: true });
      writeFileSync(join(secretDir, "placeholder"), "secret");
      await expect(resolveSandboxExtraMounts([`${secretDir}:secret:ro`], "docker"))
        .rejects.toThrow('blocked pattern ".ssh"');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("requires directories for Apple container sandbox mounts", async () => {
    const root = mkdtempSync(join(tmpdir(), "onmyagent-sandbox-root-"));
    const filePath = join(root, "file.txt");
    const { dir } = withAllowlist({
      allowedRoots: [{ path: root, allowReadWrite: true }],
    });

    try {
      writeFileSync(filePath, "ok");
      await expect(resolveSandboxExtraMounts([`${filePath}:file:ro`], "container"))
        .rejects.toThrow("Apple container sandbox mounts must be directories");
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
