import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveLocalSkillsRoot } from "./config-profile-paths.mjs";
import {
  resolveDesktopOpencodeRuntimeIdentity,
  resolveDesktopGrokRuntimePolicy,
  resolveDesktopGrokProxyEnvironment,
  resolveDesktopOpencodeRuntimeHome,
} from "./primary-runtime-policy.mjs";
import {
  createRuntimeManager,
  prioritizeWorkspacePaths,
  snapshotOnMyAgentServerState,
} from "./runtime.mjs";

async function linkOrShimExecutable(source, target) {
  try {
    await link(source, target);
    return;
  } catch (error) {
    if (!["EPERM", "EXDEV"].includes(error?.code)) throw error;
  }
  const shim = process.platform === "win32"
    ? `@echo off\r\n"${source}" %*\r\n`
    : `#!/bin/sh\nexec "${source}" "$@"\n`;
  await writeFile(target, shim, "utf8");
  await chmod(target, 0o755);
}

describe("prioritizeWorkspacePaths", () => {
  it("keeps the active runtime workspace first", () => {
    assert.deepEqual(
      prioritizeWorkspacePaths("/workspace/current", ["/workspace/other", "/workspace/current"]),
      ["/workspace/current", "/workspace/other"],
    );
  });

  it("dedupes equivalent paths", () => {
    assert.deepEqual(
      prioritizeWorkspacePaths("/workspace/current/../current", ["/workspace/current"]),
      ["/workspace/current/../current"],
    );
  });
});

describe("snapshotOnMyAgentServerState", () => {
  it("does not report stale in-process servers as running when health is unreachable", () => {
    const snapshot = snapshotOnMyAgentServerState(
      {
        child: null,
        childExited: true,
        inProcess: true,
        remoteAccessEnabled: false,
        host: "127.0.0.1",
        port: 61276,
        baseUrl: "http://127.0.0.1:61276",
        connectUrl: null,
        mdnsUrl: null,
        lanUrl: null,
        clientToken: "client-token",
        ownerToken: "owner-token",
        hostToken: "host-token",
        managedOpencodeBinPath: null,
        managedOpencodeBinSource: null,
        lastStdout: null,
        lastStderr: "health probe failed",
      },
      { reachable: false },
    );

    assert.equal(snapshot.running, false);
    assert.equal(snapshot.baseUrl, "http://127.0.0.1:61276");
    assert.equal(snapshot.pid, null);
  });
});

describe("primary runtime MCP descriptor provider", () => {
  it("accepts only a host callback", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-mcp-provider-"));
    const manager = createRuntimeManager({
      app: {
        getPath(name) {
          if (name === "home") return path.join(root, "home");
          if (name === "exe") return process.execPath;
          return path.join(root, name);
        },
      },
      desktopRoot: path.join(root, "desktop"),
      listLocalWorkspacePaths: async () => [],
    });
    try {
      assert.throws(
        () => manager.setPrimaryRuntimeMcpProjectionProvider(null),
        /must be a function/,
      );
      assert.doesNotThrow(() => manager.setPrimaryRuntimeMcpProjectionProvider(async () => ({
        descriptors: [],
        accounts: [],
        complete: true,
      })));
    } finally {
      await manager.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("resolveDesktopOpencodeRuntimeHome", () => {
  it("uses the exact managed XDG data root", () => {
    assert.equal(
      resolveDesktopOpencodeRuntimeHome(
        { XDG_DATA_HOME: "/fixture/managed/data" },
        { homeDir: "/fixture/home" },
      ),
      path.join("/fixture/managed/data", "opencode"),
    );
  });

  it("matches OpenCode's xdg-basedir fallback when XDG is absent", () => {
    assert.equal(
      resolveDesktopOpencodeRuntimeHome(
        { APPDATA: "C:\\Users\\fixture\\AppData\\Roaming" },
        { homeDir: "C:\\Users\\fixture" },
      ),
      path.join("C:\\Users\\fixture", ".local", "share", "opencode"),
    );
    assert.equal(
      resolveDesktopOpencodeRuntimeHome(
        {},
        { homeDir: "/Users/fixture" },
      ),
      path.join("/Users/fixture", ".local", "share", "opencode"),
    );
  });

  it("keeps managed and explicit real-home identities distinct", () => {
    assert.deepEqual(
      resolveDesktopOpencodeRuntimeIdentity(
        { XDG_DATA_HOME: "/fixture/managed/data" },
        { homeDir: "/Users/fixture" },
      ),
      {
        profileId: "desktop-managed",
        runtimeHome: path.join("/fixture/managed/data", "opencode"),
        sandboxProfile: "desktop-managed",
      },
    );
    assert.deepEqual(
      resolveDesktopOpencodeRuntimeIdentity(
        { ONMYAGENT_OPENCODE_USE_REAL_HOME: "1" },
        { homeDir: "/Users/fixture" },
      ),
      {
        profileId: "desktop-system",
        runtimeHome: path.join("/Users/fixture", ".local", "share", "opencode"),
      },
    );
  });
});

describe("resolveDesktopGrokRuntimePolicy", () => {
  it("uses the existing system Grok profile without exposing a new home", () => {
    assert.deepEqual(
      resolveDesktopGrokRuntimePolicy(
        { path: "/Users/fixture/.grok/bin/grok", version: "grok 1.0.0 (fixture)" },
        {
          PATH: "/fixture/bin",
          HTTPS_PROXY: "http://proxy.invalid",
          UNRELATED_SECRET: "must-not-enter-child",
        },
        { homeDir: "/Users/fixture" },
      ),
      {
        profileId: "system",
        binaryPath: "/Users/fixture/.grok/bin/grok",
        expectedVersion: "1.0.0",
        runtimeHome: path.join("/Users/fixture", ".grok"),
        environment: {
          PATH: "/fixture/bin",
          HTTPS_PROXY: "http://proxy.invalid",
        },
        rollout: {
          newSessionsEnabled: true,
          workspaceAllowlist: [],
        },
      },
    );
    assert.equal(
      resolveDesktopGrokRuntimePolicy(null, {}, { homeDir: "/Users/fixture" }),
      null,
    );
  });

  it("keeps Grok unavailable when no audited system binary is discovered", () => {
    assert.equal(
      resolveDesktopGrokRuntimePolicy(null, {}, { homeDir: "/Users/fixture" }),
      null,
    );
  });

  it("accepts audited Grok 1.0.3 without assuming session-admin extensions", () => {
    assert.equal(
      resolveDesktopGrokRuntimePolicy(
        { path: "/fixture/grok", version: "grok 1.0.3 (fixture)" },
        {},
        { homeDir: "/Users/fixture" },
      )?.expectedVersion,
      "1.0.3",
    );
  });

  it("enables new Grok sessions by default and still honors an explicit disable", () => {
    const enabled = resolveDesktopGrokRuntimePolicy(
      { path: "/fixture/grok", version: "grok 1.0.1" },
      {},
      { homeDir: "/Users/fixture" },
    );
    assert.equal(enabled.rollout.newSessionsEnabled, true);
    const disabled = resolveDesktopGrokRuntimePolicy(
      { path: "/fixture/grok", version: "grok 1.0.1" },
      { ONMYAGENT_GROK_PRIMARY_ENABLED: "0" },
      { homeDir: "/Users/fixture" },
    );
    assert.equal(disabled.rollout.newSessionsEnabled, false);
  });

  it("projects a host-only kill switch and bounded workspace allowlist", () => {
    const policy = resolveDesktopGrokRuntimePolicy(
      { path: "/fixture/grok", version: "grok 1.0.1" },
      {
        ONMYAGENT_GROK_PRIMARY_KILL_SWITCH: "1",
        ONMYAGENT_GROK_PRIMARY_ENABLED: "1",
        ONMYAGENT_GROK_PRIMARY_WORKSPACE_ALLOWLIST: "alpha, beta,alpha",
      },
      { homeDir: "/Users/fixture" },
    );
    assert.equal(policy.rollout.newSessionsEnabled, false);
    assert.deepEqual(policy.rollout.workspaceAllowlist, ["alpha", "beta"]);
  });

  it("offers an isolated managed profile without changing the system default", () => {
    const policy = resolveDesktopGrokRuntimePolicy(
      { path: "/fixture/grok", version: "grok 1.0.1" },
      {
        PATH: "/fixture/bin",
        XAI_API_KEY: "fixture-key",
        HTTPS_PROXY: "http://proxy.invalid",
      },
      { homeDir: "/Users/fixture", userDataDir: "/Users/fixture/Library/OnMyAgent" },
    );
    assert.equal(policy.profileId, "system");
    assert.equal(policy.runtimeHome, path.join("/Users/fixture", ".grok"));
    assert.deepEqual(policy.profiles.managed, {
      binaryPath: "/fixture/grok",
      expectedVersion: "1.0.1",
      runtimeHome: path.join(
        "/Users/fixture/Library/OnMyAgent",
        "runtime-state",
        "grok",
      ),
      sandboxProfile: "desktop-managed",
      environment: {
        PATH: "/fixture/bin",
        HTTPS_PROXY: "http://proxy.invalid",
      },
    });
  });

  it("offers checksum-verified bundled binaries independently of profile home", () => {
    const policy = resolveDesktopGrokRuntimePolicy(
      { path: "/Users/fixture/.grok/bin/grok", version: "grok 1.0.3" },
      { PATH: "/fixture/bin" },
      {
        homeDir: "/Users/fixture",
        userDataDir: "/Users/fixture/Library/OnMyAgent",
        bundledBinary: { path: "/app/sidecars/grok", version: "1.0.1" },
        scutilOutput: "",
      },
    );
    assert.deepEqual(policy.profiles["system-bundled"], {
      binaryPath: "/app/sidecars/grok",
      expectedVersion: "1.0.1",
      runtimeHome: path.join("/Users/fixture", ".grok"),
      environment: { PATH: "/fixture/bin" },
    });
    assert.deepEqual(policy.profiles["managed-bundled"], {
      binaryPath: "/app/sidecars/grok",
      expectedVersion: "1.0.1",
      runtimeHome: path.join(
        "/Users/fixture/Library/OnMyAgent",
        "runtime-state",
        "grok",
      ),
      sandboxProfile: "desktop-managed",
      environment: { PATH: "/fixture/bin" },
    });
  });

  it("fails closed for unknown or unaudited system binary versions", () => {
    assert.equal(
      resolveDesktopGrokRuntimePolicy(
        { path: "/fixture/grok", version: "grok future" },
        {},
        { homeDir: "/Users/fixture" },
      ),
      null,
    );
    assert.equal(
      resolveDesktopGrokRuntimePolicy(
        { path: "/fixture/grok", version: "grok 2.0.0" },
        {},
        { homeDir: "/Users/fixture" },
      ),
      null,
    );
  });
});

describe("resolveDesktopGrokProxyEnvironment", () => {
  it("keeps explicit proxy env and maps enabled macOS system proxies", () => {
    assert.deepEqual(
      resolveDesktopGrokProxyEnvironment(
        { HTTPS_PROXY: "http://explicit.invalid:80" },
        { platform: "darwin", scutilOutput: "HTTPSProxy : ignored" },
      ),
      { HTTPS_PROXY: "http://explicit.invalid:80" },
    );
    assert.deepEqual(
      resolveDesktopGrokProxyEnvironment({}, {
        platform: "darwin",
        scutilOutput: `\n<dictionary> {\n  HTTPEnable : 1\n  HTTPPort : 7890\n  HTTPProxy : 127.0.0.1\n  HTTPSEnable : 1\n  HTTPSPort : 7890\n  HTTPSProxy : 127.0.0.1\n}\n`,
      }),
      {
        HTTP_PROXY: "http://127.0.0.1:7890",
        HTTPS_PROXY: "http://127.0.0.1:7890",
      },
    );
  });
});

describe("runtime skill links", () => {
  it("makes newly installed user skills visible without restarting the engine", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-skill-refresh-"));
    const home = path.join(root, "home");
    const skillRoot = path.join(
      resolveLocalSkillsRoot(home),
      "introduce-order-dispatch",
    );
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      path.join(skillRoot, "SKILL.md"),
      "---\nname: introduce-order-dispatch\ndescription: test\n---\n",
      "utf8",
    );
    const manager = createRuntimeManager({
      app: {
        getPath(name) {
          if (name === "home") return home;
          if (name === "exe") return process.execPath;
          return path.join(root, name);
        },
      },
      desktopRoot: path.join(root, "desktop"),
      listLocalWorkspacePaths: async () => [],
    });

    try {
      await manager.refreshSkillLinks();
      const linkedSkill = path.join(
        root,
        "userData",
        "opencode",
        "skills",
        "introduce-order-dispatch",
        "SKILL.md",
      );
      assert.equal(existsSync(linkedSkill), true);
    } finally {
      await manager.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the explicit user home for managed skill discovery", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-runtime-home-"));
    const electronHome = path.join(root, "electron-home");
    const realHome = path.join(root, "real-home");
    const skillRoot = path.join(resolveLocalSkillsRoot(realHome), "officecli");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      path.join(skillRoot, "SKILL.md"),
      "---\nname: officecli\ndescription: test\n---\n",
      "utf8",
    );
    const manager = createRuntimeManager({
      app: {
        getPath(name) {
          if (name === "home") return electronHome;
          if (name === "exe") return process.execPath;
          return path.join(root, name);
        },
      },
      desktopRoot: path.join(root, "desktop"),
      listLocalWorkspacePaths: async () => [],
      homeDir: realHome,
    });

    try {
      await manager.refreshSkillLinks();
      assert.equal(
        existsSync(path.join(root, "userData", "opencode", "skills", "officecli", "SKILL.md")),
        true,
      );
    } finally {
      await manager.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("software environment", () => {
  it("uses bundled Node and Python and installs the bundled OpenCode CLI", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-runtime-test-"));
    const home = path.join(root, "home");
    const desktopRoot = path.join(root, "desktop");
    const triple =
      process.platform === "darwin"
        ? process.arch === "arm64"
          ? "aarch64-apple-darwin"
          : "x86_64-apple-darwin"
        : process.platform === "linux"
          ? process.arch === "arm64"
            ? "aarch64-unknown-linux-gnu"
            : "x86_64-unknown-linux-gnu"
          : process.arch === "arm64"
            ? "aarch64-pc-windows-msvc"
            : "x86_64-pc-windows-msvc";
    const runtimeRoot = path.join(desktopRoot, "resources", "runtimes", triple);
    const sidecarsRoot = path.join(desktopRoot, "resources", "sidecars");
    const nodeTarget = path.join(
      runtimeRoot,
      "node",
      process.platform === "win32" ? "node.exe" : "bin/node",
    );
    const pythonTarget = path.join(
      runtimeRoot,
      "python",
      process.platform === "win32" ? "python.exe" : "bin/python3",
    );
    const opencodeTarget = path.join(
      sidecarsRoot,
      process.platform === "win32" ? "opencode.exe" : "opencode",
    );
    const pythonSource = execFileSync(
      process.platform === "win32" ? "where.exe" : "sh",
      process.platform === "win32"
        ? ["python.exe"]
        : ["-c", "command -v python3"],
      { encoding: "utf8" },
    ).trim().split(/\r?\n/)[0];
    const repoOpencode = path.resolve(
      "apps/desktop/resources/sidecars",
      process.platform === "win32" ? "opencode.exe" : "opencode",
    );

    await mkdir(path.dirname(nodeTarget), { recursive: true });
    await mkdir(path.dirname(pythonTarget), { recursive: true });
    await mkdir(sidecarsRoot, { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFile(nodeTarget, `#!/bin/sh\nexec "${process.execPath}" "$@"\n`, "utf8");
    await chmod(nodeTarget, 0o755);
    await linkOrShimExecutable(pythonSource, pythonTarget);
    await linkOrShimExecutable(repoOpencode, opencodeTarget);

    const originalPath = process.env.PATH;
    const originalPathCapitalized = process.env.Path;
    const originalPathLowercase = process.env.path;
    process.env.PATH = "";
    process.env.Path = "";
    process.env.path = "";
    const manager = createRuntimeManager({
      app: {
        getPath(name) {
          if (name === "home") return home;
          if (name === "exe") return process.execPath;
          return path.join(root, name);
        },
      },
      desktopRoot,
      listLocalWorkspacePaths: async () => [],
    });

    try {
      assert.ok(manager.runtimePathEntries().includes(path.dirname(nodeTarget)));
      const before = manager.softwareEnvironmentInfo();
      assert.equal(before.node, true);
      assert.equal(before.python, true);
      assert.equal(before.opencode, true);
      assert.equal(before.details?.opencode.bundled, true);
      assert.equal(before.details?.opencode.path, opencodeTarget);
      assert.equal(typeof before.details?.opencode.version, "string");

      const progress = [];
      const installed = await manager.engineInstall((event) => progress.push(event));
      assert.equal(installed.ok, true);
      assert.equal(progress.at(-1)?.progress, 100);
      assert.equal(
        existsSync(
          path.join(
            home,
            ".opencode",
            "bin",
            process.platform === "win32" ? "opencode.exe" : "opencode",
          ),
        ),
        true,
      );
      const after = manager.softwareEnvironmentInfo();
      assert.equal(after.opencode, true);
      // After install to ~/.opencode/bin, a version-compatible local copy may
      // be selected; product still reports an available OpenCode runtime.
      assert.ok(after.details?.opencode.path);
      assert.equal(typeof after.details?.opencode.version, "string");
      assert.equal(execFileSync(installed.path, ["--version"], { encoding: "utf8" }).trim().length > 0, true);
    } finally {
      await manager.dispose();
      process.env.PATH = originalPath;
      process.env.Path = originalPathCapitalized;
      process.env.path = originalPathLowercase;
      await rm(root, { recursive: true, force: true });
    }
  });
});
