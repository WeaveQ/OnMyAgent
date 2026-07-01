import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { agentManagementMcpSnapshot, deleteMcpServerAction, importMcpFromApps, toggleMcpServerApp, upsertMcpServer } from "./agent-management-mcp.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "studio-mcp-test-"));
  const homeDir = path.join(root, "home");
  const configPaths = {
    claude: path.join(homeDir, ".claude.json"),
    codex: path.join(homeDir, ".codex", "config.toml"),
    gemini: path.join(homeDir, ".gemini", "settings.json"),
    opencode: path.join(homeDir, ".config", "opencode", "opencode.json"),
    hermes: path.join(homeDir, ".hermes", "config.yaml"),
  };
  for (const filePath of Object.values(configPaths)) await mkdir(path.dirname(filePath), { recursive: true });
  return { root, options: { homeDir, databasePath: path.join(root, "studio-switch.db"), configPaths, shouldSync: () => true }, configPaths };
}

describe("agent-management MCP parity", () => {
  it("returns an empty snapshot for a fresh database", async () => {
    const { root, options } = await fixture();
    try {
      const snapshot = await agentManagementMcpSnapshot(options);
      assert.equal(snapshot.total, 0);
      assert.deepEqual(snapshot.servers, []);
      assert.equal(snapshot.countsByApp.codex, 0);
      assert.equal(snapshot.apps.codex.syncSupported, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("imports installed agent configs", async () => {
    const { root, options, configPaths } = await fixture();
    try {
      await writeFile(configPaths.claude, JSON.stringify({ mcpServers: { fs: { type: "stdio", command: "npx", args: ["server-fs"] } } }), "utf8");
      await writeFile(configPaths.codex, '[mcp_servers.fetch]\ntype = "sse"\nurl = "https://example.com/sse"\n', "utf8");
      await writeFile(configPaths.gemini, JSON.stringify({ mcpServers: { web: { httpUrl: "https://example.com/http" } } }), "utf8");
      await writeFile(configPaths.opencode, JSON.stringify({ mcp: { local: { type: "local", command: ["node", "server.js"], environment: { A: "B" } } } }), "utf8");
      await writeFile(configPaths.hermes, 'mcp_servers:\n  hx:\n    command: uvx\n    args:\n      - hermes\n    timeout: 30\n', "utf8");
      const result = await importMcpFromApps({}, options);
      assert.equal(result.imported, 5);
      const snapshot = await agentManagementMcpSnapshot(options);
      assert.equal(snapshot.total, 5);
      assert.equal(snapshot.servers.find((server) => server.id === "fs")?.apps.claude, true);
      assert.equal(snapshot.servers.find((server) => server.id === "fetch")?.apps.codex, true);
      assert.equal(snapshot.servers.find((server) => server.id === "web")?.server.type, "http");
      assert.equal(snapshot.servers.find((server) => server.id === "local")?.server.command, "node");
      assert.equal(snapshot.servers.find((server) => server.id === "hx")?.apps.hermes, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("syncs, toggles, and removes using agent-specific formats", async () => {
    const { root, options, configPaths } = await fixture();
    try {
      await writeFile(configPaths.hermes, 'mcp_servers:\n  demo:\n    command: old\n    timeout: 30\n    auth: oauth\n', "utf8");
      await writeFile(configPaths.codex, '[mcp.servers.legacy]\ntype = "stdio"\ncommand = "old"\n', "utf8");
      await upsertMcpServer({
        id: "demo",
        name: "Demo",
        server: { type: "stdio", command: "npx", args: ["-y", "demo"], env: { TOKEN: "x" } },
        apps: { claude: true, codex: true, gemini: true, opencode: true, hermes: true },
      }, options);
      const claude = JSON.parse(await readFile(configPaths.claude, "utf8"));
      const gemini = JSON.parse(await readFile(configPaths.gemini, "utf8"));
      const opencode = JSON.parse(await readFile(configPaths.opencode, "utf8"));
      const codex = await readFile(configPaths.codex, "utf8");
      const hermes = await readFile(configPaths.hermes, "utf8");
      assert.equal(claude.mcpServers.demo.command, "npx");
      assert.equal(gemini.mcpServers.demo.timeout, 60000);
      assert.deepEqual(opencode.mcp.demo.command, ["npx", "-y", "demo"]);
      assert.match(codex, /\[mcp_servers\.demo\]/);
      assert.doesNotMatch(codex, /\[mcp\.servers\.legacy\]/);
      assert.match(hermes, /timeout: 30/);
      assert.match(hermes, /auth: oauth/);

      await toggleMcpServerApp({ id: "demo", app: "codex", enabled: false }, options);
      assert.doesNotMatch(await readFile(configPaths.codex, "utf8"), /\[mcp_servers\.demo\]/);
      await deleteMcpServerAction({ id: "demo" }, options);
      assert.equal((JSON.parse(await readFile(configPaths.claude, "utf8"))).mcpServers.demo, undefined);
      assert.equal((JSON.parse(await readFile(configPaths.opencode, "utf8"))).mcp.demo, undefined);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("parses Codex nested env tables as server metadata, not separate servers", async () => {
    const { root, options, configPaths } = await fixture();
    try {
      await writeFile(configPaths.codex, `[mcp_servers.knowledge-base]
type = "stdio"
command = "npx"
args = ["-y", "@example/mcp"]

[mcp_servers.knowledge-base.env]
OBSIDIAN_API_TOKEN = "redacted"
OBSIDIAN_API_PORT = "27124"

[mcp_servers.remote.headers]
Authorization = "Bearer redacted"

[mcp_servers.remote]
type = "sse"
url = "https://example.com/sse"
`, "utf8");
      const result = await importMcpFromApps({ app: "codex" }, options);
      assert.equal(result.imported, 2);
      const snapshot = await agentManagementMcpSnapshot(options);
      assert.equal(snapshot.total, 2);
      assert.equal(snapshot.servers.some((server) => server.id === "knowledge-base.env"), false);
      assert.equal(snapshot.servers.find((server) => server.id === "knowledge-base")?.server.env.OBSIDIAN_API_PORT, "27124");
      assert.equal(snapshot.servers.find((server) => server.id === "remote")?.server.headers.Authorization, "Bearer redacted");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid specs and updates duplicate ids in place", async () => {
    const { root, options } = await fixture();
    try {
      await assert.rejects(
        upsertMcpServer({ id: "bad", server: { type: "stdio", command: "   " }, apps: { codex: true } }, options),
        /stdio MCP requires command/,
      );
      await upsertMcpServer({ id: "dup", name: "First", server: { type: "stdio", command: "node", args: ["a"] }, apps: { codex: true } }, options);
      await upsertMcpServer({ id: "dup", name: "Second", server: { type: "http", url: "https://example.com/mcp" }, apps: { hermes: true } }, options);
      const snapshot = await agentManagementMcpSnapshot(options);
      assert.equal(snapshot.total, 1);
      assert.equal(snapshot.servers[0].name, "Second");
      assert.equal(snapshot.servers[0].server.type, "http");
      assert.equal(snapshot.servers[0].apps.codex, false);
      assert.equal(snapshot.servers[0].apps.hermes, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("migrates older local databases that were created before metadata columns", async () => {
    const { root, options } = await fixture();
    try {
      const db = new DatabaseSync(options.databasePath);
      try {
        db.exec(`CREATE TABLE mcp_servers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          server_config TEXT NOT NULL,
          enabled_claude INTEGER NOT NULL DEFAULT 0,
          enabled_codex INTEGER NOT NULL DEFAULT 0,
          enabled_gemini INTEGER NOT NULL DEFAULT 0,
          enabled_opencode INTEGER NOT NULL DEFAULT 0,
          enabled_hermes INTEGER NOT NULL DEFAULT 0
        )`);
        db.prepare("INSERT INTO mcp_servers (id, name, server_config, enabled_codex) VALUES (?, ?, ?, ?)").run(
          "legacy",
          "Legacy",
          JSON.stringify({ type: "stdio", command: "node" }),
          1,
        );
      } finally {
        db.close();
      }
      const snapshot = await agentManagementMcpSnapshot(options);
      assert.equal(snapshot.total, 1);
      assert.equal(snapshot.servers[0].id, "legacy");
      assert.equal(snapshot.servers[0].apps.codex, true);
      assert.ok(snapshot.servers[0].createdAt > 0);
      assert.ok(snapshot.servers[0].updatedAt > 0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
