import { afterEach, describe, expect, test } from "bun:test";
import { createServer } from "node:http";

import {
  fetchOpenCodeRouterHealth,
  fetchOpenCodeRouterHealthViaOpenwork,
  waitForHealthy,
  waitForHealthyViaProxy,
  waitForOpencodeHealthy,
  waitForRouterHealthy,
} from "../src/runtime-health";

type TestServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

async function createTestServer(handler: Parameters<typeof createServer>[0]): Promise<TestServer> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe("runtime health", () => {
  afterEach(() => {
    delete process.env.NO_PROXY;
  });

  test("waits for generic and router health endpoints", async () => {
    const server = await createTestServer((req, res) => {
      res.writeHead(req.url === "/health" ? 200 : 404).end();
    });

    try {
      await waitForHealthy(server.baseUrl, 100, 10);
      await waitForRouterHealthy(server.baseUrl, 100, 10);
    } finally {
      await server.close();
    }
  });

  test("fetches router health directly and through onmyagent", async () => {
    const snapshot = { ok: true, opencode: { url: "http://x", healthy: true }, channels: { telegram: false, whatsapp: false, slack: false }, config: { groupsEnabled: false } };
    const server = await createTestServer((req, res) => {
      if (req.url === "/opencode-router/health") {
        expect(req.headers.authorization).toBe("Bearer token");
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(snapshot));
    });

    try {
      expect(await fetchOpenCodeRouterHealth(server.baseUrl)).toEqual(snapshot);
      expect(await fetchOpenCodeRouterHealthViaOpenwork(server.baseUrl, "token")).toEqual(snapshot);
    } finally {
      await server.close();
    }
  });

  test("accepts proxy health auth responses below 500", async () => {
    const server = await createTestServer((req, res) => {
      expect(req.headers.authorization).toBe("Bearer token");
      res.writeHead(401).end();
    });

    try {
      await waitForHealthyViaProxy(server.baseUrl, "token", 100, 10);
    } finally {
      await server.close();
    }
  });

  test("uses opencode path probe when health is degraded", async () => {
    const client = {
      global: { health: async () => ({ data: { healthy: false } }) },
      path: { get: async () => ({ data: { cwd: "/tmp" } }) },
    };

    expect(await waitForOpencodeHealthy(client, 100, 10)).toEqual({
      healthy: true,
      degraded: true,
      reason: "Server reported unhealthy",
    });
  });
});
