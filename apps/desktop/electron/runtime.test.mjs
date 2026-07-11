import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRuntimeManager, prioritizeWorkspacePaths, snapshotOnMyAgentServerState } from "./runtime.mjs";

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
      assert.equal(after.details?.opencode.bundled, true);
      assert.equal(after.details?.opencode.path, opencodeTarget);
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
