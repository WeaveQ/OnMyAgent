import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MCP_SERVER_NAME,
  MCP_URL,
  PLUGIN_ID,
  SKILL_VERSION,
} from "./constants.mjs";
import {
  buildTencentMeetingMcpEntry,
  createTencentMeetingConnectorManager,
  hasManagedTencentMeetingMcp,
  removeTencentMeetingMcp,
  upsertTencentMeetingMcp,
} from "./manager.mjs";

test("upsert and remove tencent-meeting MCP with token headers", () => {
  let config = upsertTencentMeetingMcp({}, "tok-meet-1");
  assert.equal(hasManagedTencentMeetingMcp(config), true);
  const entry = /** @type {Record<string, any>} */ (config.mcp)[MCP_SERVER_NAME];
  assert.equal(entry.type, "remote");
  assert.equal(entry.url, MCP_URL);
  assert.equal(entry.headers["X-Tencent-Meeting-Token"], "tok-meet-1");
  assert.equal(entry.headers["X-Skill-Version"], SKILL_VERSION);
  assert.equal(entry._onmyagent.pluginId, PLUGIN_ID);
  assert.equal(
    buildTencentMeetingMcpEntry("tok-meet-1").headers["X-Tencent-Meeting-Token"],
    "tok-meet-1",
  );

  config = removeTencentMeetingMcp(config);
  assert.equal(hasManagedTencentMeetingMcp(config), false);
});

test("connectWithToken writes tokens + opencode mcp", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "tencent-meeting-"));
  const opencodeRoot = path.join(home, ".config", "opencode");
  await mkdir(opencodeRoot, { recursive: true });
  await writeFile(
    path.join(opencodeRoot, "opencode.json"),
    `${JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2)}\n`,
    "utf8",
  );

  try {
    const manager = createTencentMeetingConnectorManager({
      homeDir: home,
      globalOpencodeRoot: opencodeRoot,
    });

    const status = await manager.connectWithToken({
      accessToken: "meet-token-xyz",
    });
    assert.equal(status.phase, "connected");
    assert.equal(status.authorized, true);
    assert.equal(status.mcpConfigured, true);

    const raw = await readFile(path.join(opencodeRoot, "opencode.json"), "utf8");
    const config = JSON.parse(raw);
    assert.equal(
      config.mcp[MCP_SERVER_NAME].headers["X-Tencent-Meeting-Token"],
      "meet-token-xyz",
    );

    const disconnected = await manager.disconnect();
    assert.equal(disconnected.phase, "disconnected");
    assert.equal(disconnected.authorized, false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
