import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isComputerUseMcpEnabled,
  readComputerUseMcpPrefsEnabled,
  resolveComputerUseRuntimeCommand,
  resolveWindowsCuaDriver,
  writeComputerUseMcpPrefsEnabled,
  writeComputerUseRuntimeConfig,
} from "./computer-use-runtime-config.mjs";

test("resolves the packaged Computer Use helper on darwin", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-computer-use-"));
  try {
    const executable = path.join(
      root,
      "resources/helpers/OnMyAgent Computer Use.app/Contents/MacOS/ComputerUse",
    );
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, "helper", "utf8");

    assert.deepEqual(
      resolveComputerUseRuntimeCommand({
        platform: "darwin",
        desktopRoot: root,
        resourcesPath: path.join(root, "resources"),
        devMode: false,
      }),
      [executable, "mcp"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resolves staged Cua driver on win32 with cmd cwd wrapper", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-cua-"));
  try {
    const executable = path.join(
      root,
      "resources/helpers/cua/cua-driver.exe",
    );
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, "driver", "utf8");
    // Sibling that real Cua packs include — stage must keep them adjacent.
    await writeFile(
      path.join(path.dirname(executable), "cua-driver-uia.exe"),
      "uia",
      "utf8",
    );

    const resolved = resolveWindowsCuaDriver({
      desktopRoot: root,
      resourcesPath: path.join(root, "resources"),
    });
    assert.ok(resolved);
    assert.deepEqual(resolved.command, [executable, "mcp"]);
    assert.equal(resolved.cwd, path.dirname(executable));

    const command = resolveComputerUseRuntimeCommand({
      platform: "win32",
      desktopRoot: root,
      resourcesPath: path.join(root, "resources"),
    });
    assert.ok(Array.isArray(command));
    assert.equal(command[0], "cmd.exe");
    assert.ok(command.some((part) => String(part).includes("cua-driver.exe")));
    assert.ok(
      command.some((part) => String(part).includes(path.dirname(executable))),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("win32 returns null when Cua is not staged", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-cua-missing-"));
  try {
    assert.equal(
      resolveComputerUseRuntimeCommand({
        platform: "win32",
        desktopRoot: root,
        resourcesPath: path.join(root, "resources"),
      }),
      null,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("MCP enabled defaults: darwin on, win32 off, env overrides", () => {
  assert.equal(isComputerUseMcpEnabled({ platform: "darwin" }), true);
  assert.equal(isComputerUseMcpEnabled({ platform: "win32" }), false);
  assert.equal(
    isComputerUseMcpEnabled({ platform: "win32", enabled: true }),
    true,
  );
  assert.equal(
    isComputerUseMcpEnabled({
      platform: "darwin",
      env: { ONMYAGENT_COMPUTER_USE_ENABLED: "0" },
    }),
    false,
  );
  assert.equal(
    isComputerUseMcpEnabled({
      platform: "win32",
      env: { ONMYAGENT_COMPUTER_USE_ENABLED: "1" },
    }),
    true,
  );
});

test("MCP prefs file is read and written under userData", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-cua-prefs-"));
  try {
    assert.equal(readComputerUseMcpPrefsEnabled(root), null);
    writeComputerUseMcpPrefsEnabled(root, true);
    assert.equal(readComputerUseMcpPrefsEnabled(root), true);
    assert.equal(
      isComputerUseMcpEnabled({ platform: "win32", userDataDir: root }),
      true,
    );
    writeComputerUseMcpPrefsEnabled(root, false);
    assert.equal(
      isComputerUseMcpEnabled({ platform: "win32", userDataDir: root }),
      false,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writes an isolated OpenCode config overlay for the built-in MCP", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "onmyagent-computer-use-"));
  try {
    const command = ["/Applications/OnMyAgent Computer Use.app/ComputerUse", "mcp"];
    const configPath = await writeComputerUseRuntimeConfig(root, command);
    const config = JSON.parse(await readFile(configPath, "utf8"));

    assert.deepEqual(config.mcp["computer-use"], {
      type: "local",
      command,
      enabled: true,
    });

    const disabledPath = await writeComputerUseRuntimeConfig(
      path.join(root, "off"),
      command,
      { enabled: false },
    );
    const disabled = JSON.parse(await readFile(disabledPath, "utf8"));
    assert.equal(disabled.mcp["computer-use"].enabled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime writes the overlay into the managed config dir after sandbox pin", async () => {
  const runtimeSource = await readFile(new URL("./runtime.mjs", import.meta.url), "utf8");

  assert.match(runtimeSource, /applyOpencodeSandboxEnv\(env, sandbox\)/);
  assert.match(runtimeSource, /if \(!env\.OPENCODE_CONFIG\?\.trim\(\)\)/);
  assert.match(runtimeSource, /env\.OPENCODE_CONFIG = await writeComputerUseRuntimeConfig/);
  assert.match(runtimeSource, /isComputerUseMcpEnabled/);
  assert.match(runtimeSource, /env\.OPENCODE_CONFIG_DIR,/);
  assert.doesNotMatch(
    runtimeSource,
    /env\.OPENCODE_CONFIG_DIR = env\.OPENCODE_CONFIG_DIR\?\.trim\(\)\s*\n\s*\? env\.OPENCODE_CONFIG_DIR\s*\n\s*: localOpencodeConfigDir/,
  );
});
