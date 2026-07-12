import { createHash, randomBytes } from "node:crypto";
import http from "node:http";

import browserTabMarkerContract from "./browser-tab-marker.cjs";

const { normalizeBrowserTabOwner } = browserTabMarkerContract;
const LOOPBACK_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 64 * 1024;

function json(response, status, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": payload.length,
    "content-type": "application/json; charset=utf-8",
  });
  response.end(payload);
}

function bearerToken(request) {
  const authorization = String(request.headers.authorization ?? "");
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request_too_large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(body && typeof body === "object" && !Array.isArray(body) ? body : {});
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    request.on("error", reject);
  });
}

function publicTab(tab) {
  return {
    tabId: tab.tabId,
    url: tab.url,
    title: tab.title,
    favicon: tab.favicon ?? null,
    isLoading: tab.isLoading ?? false,
    isActive: tab.isActive ?? false,
  };
}

export function createBrowserUseBroker({
  panel,
  cdpPort,
  runtimeStatus,
  host = LOOPBACK_HOST,
  tokenFactory = () => randomBytes(32).toString("base64url"),
}) {
  if (host !== LOOPBACK_HOST) {
    throw new Error("Browser Use broker must bind to 127.0.0.1");
  }

  const ownerTokens = new Map();
  const tokenOwners = new Map();
  let server = null;
  let brokerUrl = "";

  function ownerForRequest(request) {
    return tokenOwners.get(bearerToken(request)) ?? null;
  }

  function tabsForOwner(ownerId) {
    return panel.listBrowserTabs({ ownerId });
  }

  function ownedTab(ownerId, tabId) {
    return tabsForOwner(ownerId).find((tab) => tab.tabId === tabId) ?? null;
  }

  async function handle(request, response) {
    const ownerId = ownerForRequest(request);
    if (!ownerId) {
      json(response, 401, { error: "unauthorized" });
      return;
    }

    const url = new URL(request.url ?? "/", brokerUrl);
    if (request.method === "GET" && url.pathname === "/v1/health") {
      const status = await runtimeStatus();
      json(response, 200, {
        ready: status.ready === true,
        target: "embedded",
        browserUseVersion: status.browserUseVersion,
        browserHarnessVersion: status.browserHarnessVersion,
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/tabs") {
      json(response, 200, { tabs: tabsForOwner(ownerId).map(publicTab) });
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/tabs") {
      const body = await readJsonBody(request);
      const rawUrl = typeof body.url === "string" ? body.url.trim() : "about:blank";
      if (!rawUrl || rawUrl.length > 4096) {
        json(response, 400, { error: "invalid_url" });
        return;
      }
      const tab = panel.createBrowserTab(rawUrl, {
        ownerId,
        select: body.select !== false,
      });
      json(response, 201, publicTab({ ...tab, url: rawUrl, title: rawUrl }));
      return;
    }

    const tabRoute = /^\/v1\/tabs\/([^/]+)(?:\/(select))?$/.exec(url.pathname);
    if (tabRoute) {
      const tabId = decodeURIComponent(tabRoute[1]);
      const tab = ownedTab(ownerId, tabId);
      if (!tab) {
        json(response, 404, { error: "tab_not_found" });
        return;
      }
      if (request.method === "POST" && tabRoute[2] === "select") {
        panel.selectBrowserTab(tabId);
        json(response, 200, publicTab(tab));
        return;
      }
      if (request.method === "DELETE" && !tabRoute[2]) {
        panel.closeBrowserTab(tabId);
        json(response, 200, { tabId });
        return;
      }
    }

    if (request.method === "DELETE" && url.pathname === "/v1/tabs") {
      json(response, 200, { tabIds: panel.closeBrowserTabsByOwner(ownerId) });
      return;
    }

    json(response, 404, { error: "not_found" });
  }

  async function start() {
    if (server) return brokerUrl;
    server = http.createServer((request, response) => {
      void handle(request, response).catch((error) => {
        if (response.headersSent) {
          response.end();
          return;
        }
        const code = error?.message === "request_too_large" ? 413 : 400;
        json(response, code, { error: error?.message || "invalid_request" });
      });
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, host, resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Browser Use broker did not expose a TCP address");
    }
    brokerUrl = `http://${host}:${address.port}`;
    return brokerUrl;
  }

  function environmentForOwner(value) {
    const ownerId = normalizeBrowserTabOwner(value);
    if (!ownerId) throw new Error("Invalid Browser Use owner id");
    if (!server || !brokerUrl) throw new Error("Browser Use broker is not started");
    let token = ownerTokens.get(ownerId);
    if (!token) {
      token = tokenFactory();
      ownerTokens.set(ownerId, token);
      tokenOwners.set(token, ownerId);
    }
    const name = createHash("sha256").update(ownerId).digest("hex").slice(0, 20);
    return {
      ANONYMIZED_TELEMETRY: "false",
      BH_DOMAIN_SKILLS: "0",
      BU_CDP_URL: `http://${LOOPBACK_HOST}:${cdpPort}`,
      BU_NAME: `onmyagent-${name}`,
      ONMYAGENT_BROWSER_BROKER_URL: brokerUrl,
      ONMYAGENT_BROWSER_BROKER_TOKEN: token,
      ONMYAGENT_BROWSER_OWNER_ID: ownerId,
    };
  }

  function releaseOwner(value) {
    const ownerId = normalizeBrowserTabOwner(value);
    if (!ownerId) return [];
    const token = ownerTokens.get(ownerId);
    ownerTokens.delete(ownerId);
    if (token) tokenOwners.delete(token);
    return panel.closeBrowserTabsByOwner(ownerId);
  }

  async function stop() {
    ownerTokens.clear();
    tokenOwners.clear();
    brokerUrl = "";
    const current = server;
    server = null;
    if (!current) return;
    await new Promise((resolve) => current.close(resolve));
  }

  return {
    environmentForOwner,
    releaseOwner,
    start,
    stop,
  };
}
