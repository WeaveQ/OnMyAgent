import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  applyOpencodeSandboxEnv,
  buildSandboxOpencodeConfig,
  pathIsInsideRoot,
  prepareOpencodeSandboxHome,
  resolveOpencodeSandboxPaths,
  sandboxOpencodeConfigDir,
  shouldKeepOpenCodeConfigOverlay,
} from "./opencode-sandbox-home.mjs";

test("buildSandboxOpencodeConfig strips plugins and keeps providers", () => {
  const out = buildSandboxOpencodeConfig({
    $schema: "https://opencode.ai/config.json",
    plugin: ["oh-my-openagent", "superpowers"],
    instructions: ["~/.opencode/skills/foo.md"],
    provider: {
      huoshan: { name: "火山" },
    },
    model: "huoshan/deepseek",
  });
  assert.deepEqual(out.plugin, []);
  assert.equal(out.instructions, undefined);
  assert.deepEqual(out.provider, { huoshan: { name: "火山" } });
  assert.equal(out.model, "huoshan/deepseek");
});

test("prepareOpencodeSandboxHome writes providers-only config and auth", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oma-sandbox-"));
  const realHome = path.join(root, "real-home");
  const userData = path.join(root, "user-data");
  await mkdir(path.join(realHome, ".config", "opencode"), { recursive: true });
  await mkdir(path.join(realHome, ".local", "share", "opencode"), {
    recursive: true,
  });
  await writeFile(
    path.join(realHome, ".config", "opencode", "opencode.json"),
    JSON.stringify({
      plugin: ["oh-my-openagent"],
      provider: { huoshan: { options: { apiKey: "k" } } },
    }),
    "utf8",
  );
  await writeFile(
    path.join(realHome, ".local", "share", "opencode", "auth.json"),
    JSON.stringify({ token: "t" }),
    "utf8",
  );

  const paths = await prepareOpencodeSandboxHome({
    userDataDir: userData,
    realHomeDir: realHome,
  });
  const expected = resolveOpencodeSandboxPaths(userData);
  assert.equal(paths.homeDir, expected.homeDir);

  const written = JSON.parse(await readFile(paths.opencodeConfigPath, "utf8"));
  assert.deepEqual(written.plugin, []);
  assert.equal(written.provider.huoshan.options.apiKey, "k");
  assert.equal(
    await readFile(path.join(paths.opencodeDataDir, "auth.json"), "utf8"),
    JSON.stringify({ token: "t" }),
  );

  const env = applyOpencodeSandboxEnv(
    {
      ONMYAGENT_REAL_HOME: realHome,
      OPENCODE_CONFIG_DIR: path.join(realHome, ".config", "opencode"),
      OPENCODE_CONFIG: path.join(
        realHome,
        ".config",
        "opencode",
        "onmyagent-computer-use.json",
      ),
    },
    paths,
  );
  assert.equal(env.HOME, paths.homeDir);
  assert.equal(env.XDG_CONFIG_HOME, paths.xdgConfigHome);
  assert.equal(env.OPENCODE_TEST_HOME, paths.homeDir);
  assert.equal(env.OPENCODE_CONFIG_DIR, sandboxOpencodeConfigDir(paths));
  assert.equal(env.OPENCODE_CONFIG, undefined);
  assert.equal(pathIsInsideRoot(env.OPENCODE_CONFIG_DIR, paths.root), true);
  assert.equal(
    shouldKeepOpenCodeConfigOverlay(
      path.join(realHome, ".config", "opencode", "onmyagent-computer-use.json"),
      paths.root,
    ),
    false,
  );
});
