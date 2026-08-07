import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { MCP_SERVER_NAMES } from "./constants.mjs";
import {
  buildTencentDocsMcpMap,
  hasManagedTencentDocsMcp,
  parseConfigObject,
  removeTencentDocsMcp,
  upsertTencentDocsMcp,
} from "./mcp-config.mjs";
import { createTencentDocsConnectorManager } from "./manager.mjs";
import {
  allocateLoopbackPort,
  buildAuthorizationUrl,
  pkceChallengeS256,
  randomHex,
} from "./oauth.mjs";

const repoSkill = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../resources/bundled-skills/tencent-docs",
);

test("mcp-config upserts and removes four managed endpoints", () => {
  let config = parseConfigObject("");
  config = upsertTencentDocsMcp(config, "tok-abc");
  assert.equal(hasManagedTencentDocsMcp(config, MCP_SERVER_NAMES), true);
  const map = /** @type {Record<string, any>} */ (config.mcp);
  assert.equal(map["tencent-docs"].headers.Authorization, "Bearer tok-abc");
  assert.equal(map["tencent-docs-slide"].url.includes("slide"), true);
  assert.equal(map["tencent-docs"]._onmyagent.pluginId, "tencent-docs");

  config = removeTencentDocsMcp(config, MCP_SERVER_NAMES);
  assert.equal(hasManagedTencentDocsMcp(config, MCP_SERVER_NAMES), false);
});

test("buildTencentDocsMcpMap covers catalog names", () => {
  const map = buildTencentDocsMcpMap("x");
  assert.deepEqual(Object.keys(map).sort(), [...MCP_SERVER_NAMES].sort());
});

test("pkce challenge is base64url without padding", () => {
  const challenge = pkceChallengeS256("verifier-example-0123456789abcdef");
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  assert.equal(challenge.includes("="), false);
});

test("buildAuthorizationUrl sets PKCE params", () => {
  const url = new URL(
    buildAuthorizationUrl({
      authorizationEndpoint: "https://docs.qq.com/scenario/open-claw.html?authType=2",
      clientId: "cid",
      redirectUri: "http://127.0.0.1:9/mcp/oauth/callback",
      codeChallenge: "chal",
      state: "st",
      resource: "https://docs.qq.com/openapi/mcp",
    }),
  );
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("client_id"), "cid");
  assert.equal(url.searchParams.get("state"), "st");
});

test("manager materializes skill and writes mcp config from tokens", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-tdocs-"));
  const opencodeRoot = path.join(home, "opencode");
  await mkdir(opencodeRoot, { recursive: true });

  const manager = createTencentDocsConnectorManager({
    homeDir: home,
    globalOpencodeRoot: opencodeRoot,
    bundledSkillSource: repoSkill,
  });

  await manager._internals.writeTokens({
    access_token: "access-1",
    refresh_token: "refresh-1",
    expires_at: Date.now() + 3600_000,
    obtained_at: Date.now(),
    token_type: "Bearer",
  });
  await manager._internals.applyMcpConfig("access-1");
  await manager._internals.materializeSkill();

  const status = await manager.getStatus();
  assert.equal(status.authorized, true);
  assert.equal(status.mcpConfigured, true);
  assert.equal(status.skillInstalled, true);
  assert.equal(status.phase, "connected");

  const skillMd = await readFile(
    path.join(home, ".onmyagent", "profiles", "local", "config", "skills", "tencent-docs", "SKILL.md"),
    "utf8",
  );
  assert.match(skillMd, /腾讯文档|Tencent Docs|tencent-docs/i);

  const cfg = JSON.parse(
    await readFile(path.join(opencodeRoot, "opencode.json"), "utf8"),
  );
  assert.equal(cfg.mcp["tencent-docs"].headers.Authorization, "Bearer access-1");
  assert.ok(cfg.mcp["tencent-docs-doc"]);
  assert.ok(cfg.mcp["tencent-docs-sheet"]);
  assert.ok(cfg.mcp["tencent-docs-slide"]);

  const after = await manager.disconnect();
  assert.equal(after.phase, "disconnected");
  assert.equal(after.authorized, false);
  assert.equal(after.mcpConfigured, false);
  assert.equal(after.skillInstalled, false);

  await rm(home, { recursive: true, force: true });
});

test("manager startConnect completes against mock OAuth server", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "oma-tdocs-oauth-"));
  const opencodeRoot = path.join(home, "opencode");
  await mkdir(opencodeRoot, { recursive: true });

  const clients = new Map();
  const codes = new Map();
  const mockPort = await allocateLoopbackPort();

  const mock = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${mockPort}`);
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };

    if (url.pathname === "/.well-known/oauth-protected-resource") {
      return json(200, {
        resource: "https://docs.qq.com/openapi/mcp",
        authorization_servers: [`http://127.0.0.1:${mockPort}`],
      });
    }
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json(200, {
        issuer: `http://127.0.0.1:${mockPort}`,
        authorization_endpoint: `http://127.0.0.1:${mockPort}/authorize`,
        token_endpoint: `http://127.0.0.1:${mockPort}/token`,
        registration_endpoint: `http://127.0.0.1:${mockPort}/register`,
        token_endpoint_auth_methods_supported: ["none"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/register" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || "{}");
      const clientId = `client-${randomHex(4)}`;
      clients.set(clientId, body);
      return json(200, {
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        redirect_uris: body.redirect_uris,
      });
    }
    if (url.pathname === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      const code = `code-${randomHex(4)}`;
      codes.set(code, {
        clientId: url.searchParams.get("client_id"),
        challenge: url.searchParams.get("code_challenge"),
      });
      res.writeHead(302, {
        location: `${redirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state ?? "")}`,
      });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const params = new URLSearchParams(raw);
      const code = params.get("code");
      if (!code || !codes.has(code)) {
        return json(400, { error: "invalid_grant" });
      }
      return json(200, {
        access_token: "mock-access",
        refresh_token: "mock-refresh",
        token_type: "Bearer",
        expires_in: 3600,
      });
    }
    json(404, { error: "not_found" });
  });

  await new Promise((resolve) => mock.listen(mockPort, "127.0.0.1", resolve));

  // Point discovery at mock by temporarily patching global fetch for metadata
  // is hard; instead monkey-patch via env is not available. Rewrite by injecting
  // through dynamic import of oauth is closed. Use real discover against mock
  // by overriding endpoints through a local fetch rewrite.

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const href = String(input);
    if (href.includes("docs.qq.com/openapi/mcp/.well-known/oauth-protected-resource")) {
      return originalFetch(`http://127.0.0.1:${mockPort}/.well-known/oauth-protected-resource`, init);
    }
    if (href.includes("docs.qq.com/.well-known/oauth-authorization-server")) {
      return originalFetch(
        `http://127.0.0.1:${mockPort}/.well-known/oauth-authorization-server`,
        init,
      );
    }
    return originalFetch(input, init);
  };

  try {
    const opened = [];
    const manager = createTencentDocsConnectorManager({
      homeDir: home,
      globalOpencodeRoot: opencodeRoot,
      bundledSkillSource: repoSkill,
      openExternal: async (url) => {
        opened.push(url);
        // Follow redirect chain: mock authorize -> loopback callback
        await originalFetch(url, { redirect: "follow" });
      },
    });

    const started = await manager.startConnect();
    assert.equal(typeof started.sessionId, "string");
    assert.ok(started.authorizationUrl);
    assert.equal(opened.length, 1);

    const status = await manager.completeConnect(started.sessionId);
    assert.equal(status.phase, "connected");
    assert.equal(status.authorized, true);
    assert.equal(status.mcpConfigured, true);
    assert.equal(status.skillInstalled, true);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise((resolve) => mock.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});
