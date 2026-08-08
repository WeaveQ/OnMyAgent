import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  isValidMcpEntry,
  parseOpencodeConfigText,
  repairOpencodeConfigData,
  repairOpencodeEngineConfigs,
  tryRepairMcpEntry,
} from "./opencode-config-repair.mjs";

test("tryRepairMcpEntry upgrades url-only remote mcp", () => {
  const fixed = tryRepairMcpEntry({
    url: "http://mcp.example.com/sse?ak=x",
  });
  assert.deepEqual(fixed, {
    url: "http://mcp.example.com/sse?ak=x",
    type: "remote",
    enabled: true,
  });
  assert.equal(isValidMcpEntry(fixed), true);
});

test("isValidMcpEntry rejects incomplete entries", () => {
  assert.equal(isValidMcpEntry({ url: "http://x" }), false);
  assert.equal(isValidMcpEntry({ type: "remote", url: "http://x" }), false);
  assert.equal(
    isValidMcpEntry({ type: "remote", url: "http://x", enabled: true }),
    true,
  );
});

test("repairOpencodeConfigData removes unsalvageable mcp", () => {
  const { data, removedMcp, fixedMcp } = repairOpencodeConfigData({
    mcp: {
      visitbeijing: { url: "http://mcp.visitbeijing.com.cn/sse?ak=x" },
      broken: { foo: 1 },
    },
  });
  assert.deepEqual(fixedMcp, ["visitbeijing"]);
  assert.deepEqual(removedMcp, ["broken"]);
  assert.equal(
    /** @type {any} */ (data.mcp).visitbeijing.type,
    "remote",
  );
});

test("parseOpencodeConfigText tolerates // comments", () => {
  const parsed = parseOpencodeConfigText(`{
    // comment
    "mcp": {}
  }`);
  assert.equal(parsed.ok, true);
});

test("repairOpencodeEngineConfigs rewrites broken file with backup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oma-oc-repair-"));
  const dir = path.join(root, "opencode");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "opencode.jsonc");
  await writeFile(
    file,
    JSON.stringify({
      mcp: { visitbeijing: { url: "http://example.com/sse" } },
    }),
    "utf8",
  );

  const result = await repairOpencodeEngineConfigs({
    homeDir: root,
    env: { XDG_CONFIG_HOME: root },
    userDataDir: "",
    runtimeConfigDirs: [dir],
  });
  assert.equal(result.ok, true);
  assert.equal(result.results.length, 1);
  const body = JSON.parse(await readFile(file, "utf8"));
  assert.equal(body.mcp.visitbeijing.type, "remote");
  assert.equal(body.mcp.visitbeijing.enabled, true);
});
