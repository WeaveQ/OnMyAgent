import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  resolveComputerUseRuntimeCommand,
  writeComputerUseRuntimeConfig,
} from "./computer-use-runtime-config.mjs";

test("resolves the packaged Computer Use helper and ignores unsupported platforms", async () => {
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
    assert.equal(
      resolveComputerUseRuntimeCommand({
        platform: "linux",
        desktopRoot: root,
        resourcesPath: path.join(root, "resources"),
        devMode: false,
      }),
      null,
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
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime injects the overlay without replacing an explicit OpenCode config", async () => {
  const runtimeSource = await readFile(new URL("./runtime.mjs", import.meta.url), "utf8");

  assert.match(runtimeSource, /if \(!env\.OPENCODE_CONFIG\?\.trim\(\)\)/);
  assert.match(runtimeSource, /env\.OPENCODE_CONFIG = await writeComputerUseRuntimeConfig/);
  assert.match(runtimeSource, /env\.OPENCODE_CONFIG_DIR,/);
});
