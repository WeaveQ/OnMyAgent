import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MCP_SERVER_NAME,
  MCP_SSE_BASE,
  PLUGIN_ID,
} from "./constants.mjs";
import {
  buildBaiduDriveMcpEntry,
  buildBaiduDriveMcpUrl,
  createBaiduDriveConnectorManager,
  hasManagedBaiduDriveMcp,
  removeBaiduDriveMcp,
  upsertBaiduDriveMcp,
} from "./manager.mjs";

test("buildBaiduDriveMcpUrl encodes access_token", () => {
  const url = buildBaiduDriveMcpUrl("tok a&b");
  assert.equal(url, `${MCP_SSE_BASE}?access_token=tok%20a%26b`);
});

test("upsert and remove baidu-netdisk MCP entry", () => {
  let config = upsertBaiduDriveMcp({}, "token-1");
  assert.equal(hasManagedBaiduDriveMcp(config), true);
  const entry = /** @type {Record<string, any>} */ (config.mcp)[MCP_SERVER_NAME];
  assert.equal(entry.type, "remote");
  assert.equal(entry.url, buildBaiduDriveMcpUrl("token-1"));
  assert.equal(entry._onmyagent.pluginId, PLUGIN_ID);
  assert.deepEqual(buildBaiduDriveMcpEntry("token-1")._onmyagent, entry._onmyagent);

  config = removeBaiduDriveMcp(config);
  assert.equal(hasManagedBaiduDriveMcp(config), false);
  assert.equal(
    /** @type {Record<string, any>} */ (config.mcp)[MCP_SERVER_NAME],
    undefined,
  );
});

test("connectWithToken writes tokens + opencode mcp when oauth not configured", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "baidu-drive-"));
  const opencodeRoot = path.join(home, ".config", "opencode");
  await mkdir(opencodeRoot, { recursive: true });
  await writeFile(
    path.join(opencodeRoot, "opencode.json"),
    `${JSON.stringify({ $schema: "https://opencode.ai/config.json" }, null, 2)}\n`,
    "utf8",
  );

  try {
    const manager = createBaiduDriveConnectorManager({
      homeDir: home,
      globalOpencodeRoot: opencodeRoot,
      // no client id/secret → needsAccessToken path
    });

    assert.equal(manager.oauthConfigured(), false);
    const started = await manager.startConnect();
    assert.equal(started.needsAccessToken, true);

    const status = await manager.connectWithToken({
      accessToken: "access-xyz",
      expiresIn: 3600,
    });
    assert.equal(status.phase, "connected");
    assert.equal(status.authorized, true);
    assert.equal(status.mcpConfigured, true);
    assert.deepEqual(await manager.getRuntimeMcpDescriptors(), [{
      name: MCP_SERVER_NAME,
      transport: "sse",
      url: buildBaiduDriveMcpUrl("access-xyz"),
    }]);

    const raw = await readFile(path.join(opencodeRoot, "opencode.json"), "utf8");
    const config = JSON.parse(raw);
    assert.equal(
      config.mcp[MCP_SERVER_NAME].url,
      buildBaiduDriveMcpUrl("access-xyz"),
    );

    const disconnected = await manager.disconnect();
    assert.equal(disconnected.phase, "disconnected");
    assert.equal(disconnected.authorized, false);
    assert.deepEqual(await manager.getRuntimeMcpDescriptors(), []);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
