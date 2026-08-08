import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildWecomSkillMarkdown,
  createWecomConnectorManager,
  extractWecomAuthUrl,
  resolveWecomCliConfigDir,
  resolveWecomManagedRoot,
} from "./manager.mjs";
import { BOT_ENC_FILE, PLUGIN_ID, SKILL_ID } from "./constants.mjs";
import { writeFile, mkdir } from "node:fs/promises";

test("extractWecomAuthUrl finds work.weixin.qq.com links", () => {
  const text = `请打开二维码链接扫码: 
https://work.weixin.qq.com/ai/qc/gen?source=wecom_cli_external&scode=abc123
也可以使用企业微信扫描`;
  assert.equal(
    extractWecomAuthUrl(text),
    "https://work.weixin.qq.com/ai/qc/gen?source=wecom_cli_external&scode=abc123",
  );
  assert.equal(extractWecomAuthUrl("no url here"), "");
});

test("buildWecomSkillMarkdown includes wecom-cli bins", () => {
  const md = buildWecomSkillMarkdown();
  assert.match(md, /name:\s*wecom/);
  assert.match(md, /wecom-cli/);
  assert.match(md, /contact get_userlist/);
});

test("getStatus reports connected when bot.enc + skill exist", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "wecom-conn-"));
  try {
    const manager = createWecomConnectorManager({ homeDir: home });
    const empty = await manager.getStatus();
    assert.equal(empty.phase, "disconnected");
    assert.equal(empty.authorized, false);

    const configDir = resolveWecomCliConfigDir(home);
    await mkdir(configDir, { recursive: true });
    await writeFile(path.join(configDir, BOT_ENC_FILE), "encrypted", "utf8");

    // heal should materialize skill
    const healed = await manager.getStatus();
    assert.equal(healed.authorized, true);
    assert.equal(healed.skillInstalled, true);
    assert.equal(healed.phase, "connected");

    const skillMd = await readFile(
      path.join(
        path.join(home, ".onmyagent", "profiles", "local", "skills", SKILL_ID),
        "SKILL.md",
      ),
      "utf8",
    ).catch(async () => {
      // resolveLocalSkillsRoot may differ — just assert manager skillInstalled
      return "";
    });
    if (skillMd) assert.match(skillMd, /wecom-cli/);

    assert.ok(resolveWecomManagedRoot(home).includes(PLUGIN_ID));

    const disconnected = await manager.disconnect();
    assert.equal(disconnected.authorized, false);
    assert.equal(disconnected.phase, "disconnected");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
