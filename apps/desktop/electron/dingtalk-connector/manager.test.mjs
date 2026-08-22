import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_PROFILES,
  MCP_PACKAGE,
  MCP_SERVER_NAME,
  PLUGIN_ID,
} from "./constants.mjs";
import {
  buildDingtalkMcpEntry,
  createDingtalkConnectorManager,
  hasManagedDingtalkMcp,
  removeDingtalkMcp,
  upsertDingtalkMcp,
} from "./manager.mjs";

test("upsert and remove dingtalk local MCP entry", () => {
  let config = upsertDingtalkMcp(
    {},
    {
      clientId: "cid",
      clientSecret: "csec",
      activeProfiles: DEFAULT_PROFILES,
    },
  );
  assert.equal(hasManagedDingtalkMcp(config), true);
  const entry = /** @type {Record<string, any>} */ (config.mcp)[MCP_SERVER_NAME];
  assert.equal(entry.type, "local");
  assert.deepEqual(entry.command, ["npx", "-y", MCP_PACKAGE]);
  assert.equal(entry.environment.DINGTALK_Client_ID, "cid");
  assert.equal(entry.environment.DINGTALK_Client_Secret, "csec");
  assert.equal(entry._onmyagent.pluginId, PLUGIN_ID);
  assert.equal(
    buildDingtalkMcpEntry({ clientId: "a", clientSecret: "b" }).environment
      .ACTIVE_PROFILES,
    DEFAULT_PROFILES,
  );

  config = removeDingtalkMcp(config);
  assert.equal(hasManagedDingtalkMcp(config), false);
});

test("connectWithCredentials writes credentials + opencode mcp", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "dingtalk-"));
  const opencodeRoot = path.join(home, ".config", "opencode");
  await mkdir(opencodeRoot, { recursive: true });
  await writeFile(
    path.join(opencodeRoot, "opencode.json"),
    `${JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2)}\n`,
    "utf8",
  );

  try {
    const manager = createDingtalkConnectorManager({
      homeDir: home,
      globalOpencodeRoot: opencodeRoot,
    });

    const status = await manager.connectWithCredentials({
      clientId: "app-id",
      clientSecret: "app-secret",
    });
    assert.equal(status.phase, "connected");
    assert.equal(status.authorized, true);
    assert.equal(status.mcpConfigured, true);
    assert.deepEqual(await manager.getRuntimeMcpDescriptors(), [{
      name: MCP_SERVER_NAME,
      transport: "stdio",
      command: "npx",
      args: ["-y", MCP_PACKAGE],
      env: {
        DINGTALK_Client_ID: "app-id",
        DINGTALK_Client_Secret: "app-secret",
        ACTIVE_PROFILES: DEFAULT_PROFILES,
      },
    }]);

    const raw = await readFile(path.join(opencodeRoot, "opencode.json"), "utf8");
    const config = JSON.parse(raw);
    assert.equal(
      config.mcp[MCP_SERVER_NAME].environment.DINGTALK_Client_ID,
      "app-id",
    );

    const disconnected = await manager.disconnect();
    assert.equal(disconnected.phase, "disconnected");
    assert.equal(disconnected.authorized, false);
    assert.deepEqual(await manager.getRuntimeMcpDescriptors(), []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
