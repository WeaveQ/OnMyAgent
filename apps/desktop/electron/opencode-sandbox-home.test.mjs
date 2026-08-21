import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  applyOpencodeSandboxEnv,
  buildSandboxOpencodeConfig,
  linkHomeConfigOpencodeSkills,
  pathIsInsideRoot,
  prepareOpencodeSandboxHome,
  resolveOpencodeSandboxPaths,
  sandboxOpencodeConfigDir,
  shouldKeepOpenCodeConfigOverlay,
} from "./opencode-sandbox-home.mjs";
import { resolveOpencodeModelsCachePath } from "./opencode-models-cache.mjs";

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
  const modelsCache = resolveOpencodeModelsCachePath(paths.xdgCacheHome);
  assert.equal(existsSync(modelsCache), true);
  assert.ok(JSON.parse(await readFile(modelsCache, "utf8")));

  const written = JSON.parse(await readFile(paths.opencodeConfigPath, "utf8"));
  assert.equal(written.plugin.length, 5);
  assert.match(String(written.plugin[0]), /knowledge-search\.mjs$/);
  assert.match(String(written.plugin[1]), /knowledge-read\.mjs$/);
  assert.ok(written.plugin.every((item) => !String(item).includes(`${path.sep}skills${path.sep}`)));
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
  assert.equal(
    env.OPENCODE_MODELS_PATH,
    resolveOpencodeModelsCachePath(paths.xdgCacheHome),
  );
  assert.equal(pathIsInsideRoot(env.OPENCODE_CONFIG_DIR, paths.root), true);
  assert.equal(
    shouldKeepOpenCodeConfigOverlay(
      path.join(realHome, ".config", "opencode", "onmyagent-computer-use.json"),
      paths.root,
    ),
    false,
  );
});

test("prepareOpencodeSandboxHome copies providers from jsonc with trailing commas", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oma-sandbox-jsonc-"));
  const realHome = path.join(root, "real-home");
  const userData = path.join(root, "user-data");
  await mkdir(path.join(realHome, ".config", "opencode"), { recursive: true });
  await writeFile(
    path.join(realHome, ".config", "opencode", "opencode.json"),
    `{
  "plugin": ["oh-my-openagent"],
  "enabled_providers": [
    "volces-deepseek",
    "deepseek",
  ],
  "provider": {
    "deepseek": {
      "name": "DeepSeek官方",
      "options": { "apiKey": "k" },
    },
  },
}
`,
    "utf8",
  );

  const paths = await prepareOpencodeSandboxHome({
    userDataDir: userData,
    realHomeDir: realHome,
  });
  const written = JSON.parse(await readFile(paths.opencodeConfigPath, "utf8"));
  assert.equal(written.provider.deepseek.name, "DeepSeek官方");
  assert.equal(written.provider.deepseek.options.apiKey, "k");
  assert.equal(written.enabled_providers, undefined);
});

test("linkHomeConfigOpencodeSkills exposes skill-creator under HOME/.config", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oma-home-skills-"));
  const configDir = path.join(root, "xdg", "config", "opencode");
  const homeDir = path.join(root, "home");
  await mkdir(path.join(configDir, "skills", "skill-creator"), { recursive: true });
  await mkdir(path.join(configDir, "skills", "kol-brief-structuring"), {
    recursive: true,
  });
  await writeFile(path.join(configDir, "skills", "skill-creator", "SKILL.md"), "---\nname: skill-creator\ndescription: create\n---\n");
  await writeFile(
    path.join(configDir, "skills", "kol-brief-structuring", "SKILL.md"),
    "---\nname: kol-brief-structuring\ndescription: expert\n---\n",
  );

  const result = await linkHomeConfigOpencodeSkills({ homeDir, configDir });
  assert.deepEqual(result.linked, ["skill-creator"]);
  const homeSkill = path.join(
    homeDir,
    ".config",
    "opencode",
    "skills",
    "skill-creator",
    "SKILL.md",
  );
  assert.equal(await readFile(homeSkill, "utf8"), "---\nname: skill-creator\ndescription: create\n---\n");
  assert.equal(
    existsSync(
      path.join(homeDir, ".config", "opencode", "skills", "kol-brief-structuring"),
    ),
    false,
  );
});
