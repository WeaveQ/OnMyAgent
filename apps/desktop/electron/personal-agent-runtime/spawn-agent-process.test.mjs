import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { spawnAgentProcess } from "./spawn-agent-process.mjs";

test("spawnAgentProcess attaches a default error listener so missing binaries do not throw", async () => {
  const missing =
    process.platform === "win32"
      ? "C:\\definitely-missing-onmyagent-agent.exe"
      : "/definitely/missing/onmyagent-agent";
  const child = spawnAgentProcess(missing, ["--version"], {
    stdio: "ignore",
    windowsHide: true,
  });
  assert.ok(child.listenerCount("error") >= 1);
  const err = await new Promise((resolve) => {
    child.once("error", resolve);
    child.once("exit", () => resolve(null));
  });
  assert.ok(err, "missing binary must emit error");
  assert.equal(err.code, "ENOENT");
});

test("legacy harness launches agents through spawnAgentProcess", () => {
  const src = readFileSync(new URL("./legacy-harness.mjs", import.meta.url), "utf8");
  assert.match(src, /spawnAgentProcess\(/);
  assert.doesNotMatch(src, /spawn\(detected\.executablePath/);
});
