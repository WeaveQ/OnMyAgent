import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  resolveLocalManagedToolsBinRoot,
  resolveLocalSkillsRoot,
} from "./config-profile-paths.mjs";
import { sandboxOpencodeConfigDir, resolveOpencodeSandboxPaths } from "./opencode-sandbox-home.mjs";
import { createRuntimeManager } from "./runtime.mjs";

test("reserves the OfficeCLI PATH before the plugin is installed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-officecli-path-"));
  const home = path.join(root, "home");
  const userData = path.join(root, "user-data");
  const toolsBinRoot = resolveLocalManagedToolsBinRoot(home);
  const manager = createRuntimeManager({
    app: {
      getPath(name) {
        if (name === "home") return home;
        if (name === "userData") return userData;
        if (name === "exe") return process.execPath;
        return path.join(root, name);
      },
    },
    desktopRoot: path.join(root, "desktop"),
    listLocalWorkspacePaths: async () => [],
    homeDir: home,
  });

  try {
    const environment = await manager.resolveChildEnvironment();

    assert.equal(environment.PATH?.split(path.delimiter)[0], toolsBinRoot);
  } finally {
    await manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("normal and expert child environments share the installed OfficeCLI runtime", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-officecli-runtime-"));
  const home = path.join(root, "home");
  const userData = path.join(root, "user-data");
  const toolsBinRoot = resolveLocalManagedToolsBinRoot(home);
  const skillPath = path.join(resolveLocalSkillsRoot(home), "officecli");
  const launcherPath = path.join(toolsBinRoot, "officecli");
  const skillContent = "---\nname: officecli\ndescription: test\n---\n";

  await mkdir(toolsBinRoot, { recursive: true });
  await mkdir(skillPath, { recursive: true });
  await writeFile(launcherPath, "#!/bin/sh\nexit 0\n", { encoding: "utf8", mode: 0o755 });
  await writeFile(path.join(skillPath, "SKILL.md"), skillContent, "utf8");

  const manager = createRuntimeManager({
    app: {
      getPath(name) {
        if (name === "home") return home;
        if (name === "userData") return userData;
        if (name === "exe") return process.execPath;
        return path.join(root, name);
      },
    },
    desktopRoot: path.join(root, "desktop"),
    listLocalWorkspacePaths: async () => [],
    homeDir: home,
  });

  try {
    const normalEnvironment = await manager.resolveChildEnvironment({
      ONMYAGENT_SESSION_KIND: "normal",
    });
    const expertEnvironment = await manager.resolveChildEnvironment({
      ONMYAGENT_SESSION_KIND: "expert",
    });
    const configDir = sandboxOpencodeConfigDir(resolveOpencodeSandboxPaths(userData));
    const materializedSkill = path.join(configDir, "skills", "officecli", "SKILL.md");

    assert.equal(normalEnvironment.OPENCODE_CONFIG_DIR, configDir);
    assert.equal(expertEnvironment.OPENCODE_CONFIG_DIR, configDir);
    assert.equal(normalEnvironment.PATH?.split(path.delimiter)[0], toolsBinRoot);
    assert.equal(expertEnvironment.PATH?.split(path.delimiter)[0], toolsBinRoot);
    assert.equal(await readFile(materializedSkill, "utf8"), skillContent);
    assert.equal(await readFile(launcherPath, "utf8"), "#!/bin/sh\nexit 0\n");
  } finally {
    await manager.dispose();
    await rm(root, { recursive: true, force: true });
  }
});
