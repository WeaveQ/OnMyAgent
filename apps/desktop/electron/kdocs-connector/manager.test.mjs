import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { MCP_SERVER_NAME, MCP_URL, PLUGIN_ID } from "./constants.mjs";
import {
  buildKdocsMcpEntry,
  createKdocsConnectorManager,
  hasManagedKdocsMcp,
  removeKdocsMcp,
  upsertKdocsMcp,
} from "./manager.mjs";

test("upsert and remove kdocs MCP entry with bearer header", () => {
  let config = upsertKdocsMcp({}, "token-1");
  assert.equal(hasManagedKdocsMcp(config), true);
  const entry = /** @type {Record<string, any>} */ (config.mcp)[MCP_SERVER_NAME];
  assert.equal(entry.type, "remote");
  assert.equal(entry.url, MCP_URL);
  assert.equal(entry.headers.Authorization, "Bearer token-1");
  assert.equal(entry._onmyagent.pluginId, PLUGIN_ID);
  assert.equal(buildKdocsMcpEntry("token-1").headers.Authorization, "Bearer token-1");

  config = removeKdocsMcp(config);
  assert.equal(hasManagedKdocsMcp(config), false);
});

test("connectWithToken writes tokens + opencode mcp", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "kdocs-"));
  const opencodeRoot = path.join(home, ".config", "opencode");
  await mkdir(opencodeRoot, { recursive: true });
  await writeFile(
    path.join(opencodeRoot, "opencode.json"),
    `${JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2)}\n`,
    "utf8",
  );

  try {
    const manager = createKdocsConnectorManager({
      homeDir: home,
      globalOpencodeRoot: opencodeRoot,
    });

    const status = await manager.connectWithToken({
      accessToken: "kdocs-token-xyz",
    });
    assert.equal(status.phase, "connected");
    assert.equal(status.authorized, true);
    assert.equal(status.mcpConfigured, true);
    assert.deepEqual(await manager.getRuntimeMcpDescriptors(), [{
      name: MCP_SERVER_NAME,
      transport: "http",
      url: MCP_URL,
      headers: { Authorization: "Bearer kdocs-token-xyz" },
    }]);

    const raw = await readFile(path.join(opencodeRoot, "opencode.json"), "utf8");
    const config = JSON.parse(raw);
    assert.equal(
      config.mcp[MCP_SERVER_NAME].headers.Authorization,
      "Bearer kdocs-token-xyz",
    );

    const disconnected = await manager.disconnect();
    assert.equal(disconnected.phase, "disconnected");
    assert.equal(disconnected.authorized, false);
    assert.deepEqual(await manager.getRuntimeMcpDescriptors(), []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
