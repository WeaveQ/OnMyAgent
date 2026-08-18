import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createDesktopRuntimeBoot,
  isOnMyAgentServerSnapshotReady,
  waitForOnMyAgentServerReady,
} from "./desktop-runtime-boot.mjs";

function readySnapshot() {
  return {
    running: true,
    baseUrl: "http://127.0.0.1:4123",
    ownerToken: "owner",
    clientToken: null,
  };
}

test("treats a reachable in-process server as ready", () => {
  assert.equal(isOnMyAgentServerSnapshotReady(readySnapshot()), true);
  assert.equal(
    isOnMyAgentServerSnapshotReady({
      running: false,
      baseUrl: "http://127.0.0.1:4123",
      ownerToken: "owner",
    }),
    false,
  );
});

test("waits until the post-start health probe becomes ready", async () => {
  const reads = [
    { running: false, baseUrl: "http://127.0.0.1:4123", ownerToken: "owner" },
    readySnapshot(),
  ];
  const snapshot = await waitForOnMyAgentServerReady(
    async () => reads.shift() ?? readySnapshot(),
    {
      timeoutMs: 1_000,
      intervalMs: 1,
      now: (() => {
        let t = 0;
        return () => {
          t += 1;
          return t;
        };
      })(),
      sleep: async () => undefined,
    },
  );
  assert.equal(snapshot.running, true);
  assert.equal(reads.length, 0);
});

test("retries engineStart after the first health window fails", async () => {
  let starts = 0;
  const boot = createDesktopRuntimeBoot({
    healthTimeoutMs: 10,
    retryDelayMs: 0,
    readWorkspaceState: async () => ({
      selectedId: "ws",
      workspaces: [{ id: "ws", path: "/tmp/ws", workspaceType: "local" }],
    }),
    writeWorkspaceState: async () => undefined,
    runtimeManager: {
      engineStart: async () => {
        starts += 1;
        return { baseUrl: "http://127.0.0.1:4123" };
      },
      orchestratorWorkspaceActivate: async () => undefined,
      onmyagentServerInfo: async () =>
        starts < 2
          ? { running: false, baseUrl: "http://127.0.0.1:4123", ownerToken: "owner" }
          : readySnapshot(),
    },
  });
  const result = await boot.bootRuntimeForSelectedWorkspace();
  assert.equal(result.ok, true);
  assert.equal(starts, 2);
  assert.equal(result.onmyagentServer.running, true);
});

test("fails only after the health window expires", async () => {
  await assert.rejects(
    () =>
      waitForOnMyAgentServerReady(
        async () => ({
          running: false,
          baseUrl: "http://127.0.0.1:4123",
          ownerToken: "owner",
        }),
        {
          timeoutMs: 10,
          intervalMs: 20,
          now: (() => {
            let t = 0;
            return () => {
              const value = t;
              t += 20;
              return value;
            };
          })(),
          sleep: async () => undefined,
        },
      ),
    /did not stay running/,
  );
});
