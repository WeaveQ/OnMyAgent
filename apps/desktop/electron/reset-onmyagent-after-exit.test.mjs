import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResetRelaunchEnv,
  isPidAlive,
  runResetAfterExit,
} from "./reset-onmyagent-after-exit.mjs";

test("isPidAlive treats missing pids as dead", () => {
  assert.equal(isPidAlive(-1), false);
  assert.equal(isPidAlive(0), false);
  assert.equal(
    isPidAlive(123, () => {
      throw Object.assign(new Error("gone"), { code: "ESRCH" });
    }),
    false,
  );
});

test("runResetAfterExit waits for the pid then wipes targets and the marker", async () => {
  let now = 0;
  let aliveChecks = 0;
  const removed = [];
  let relaunched = null;
  await runResetAfterExit(
    {
      pid: 4242,
      targets: ["/tmp/a", "/tmp/b"],
      markerPath: "/tmp/marker",
      relaunch: { execPath: "/bin/echo", args: ["hello"] },
    },
    {
      now: () => now,
      sleep: async () => {
        now += 200;
      },
      alive: () => {
        aliveChecks += 1;
        return aliveChecks < 2;
      },
      remove: async (target) => {
        removed.push(target);
      },
      removeMarker: async (file) => {
        removed.push(`marker:${file}`);
      },
      spawnRelaunch: (execPath, args, env) => {
        relaunched = { execPath, args, env };
      },
    },
  );
  assert.deepEqual(removed, ["/tmp/a", "/tmp/b", "marker:/tmp/marker"]);
  assert.equal(relaunched.execPath, "/bin/echo");
  assert.deepEqual(relaunched.args, ["hello"]);
});

test("reset relaunch env unsets ELECTRON_RUN_AS_NODE instead of blanking it", () => {
  const env = buildResetRelaunchEnv({
    ELECTRON_RUN_AS_NODE: "1",
    PATH: "/usr/bin",
  });
  assert.equal(Object.hasOwn(env, "ELECTRON_RUN_AS_NODE"), false);
  assert.equal(env.PATH, "/usr/bin");
});
