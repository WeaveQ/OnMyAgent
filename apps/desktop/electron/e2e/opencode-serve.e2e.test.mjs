import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { after, test } from "node:test";

import { waitForHealthy } from "./opencode-serve.mjs";

const servers = [];

after(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections?.();
    server.close();
    await once(server, "close");
  }
});

test("health polling retries after a stalled request", async () => {
  let requests = 0;
  const server = http.createServer((_request, response) => {
    requests += 1;
    if (requests === 1) return;
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"healthy":true}');
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  const health = await waitForHealthy(
    {
      baseUrl: `http://127.0.0.1:${address.port}`,
      getOutput: () => "",
      isAlive: () => true,
    },
    { timeoutMs: 1_000, pollMs: 10, requestTimeoutMs: 50 },
  );

  assert.equal(health.healthy, true);
  assert.equal(requests, 2);
});
