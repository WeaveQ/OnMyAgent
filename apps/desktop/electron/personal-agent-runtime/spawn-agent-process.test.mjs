import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { spawnAcpClient } from "./acp-client.mjs";
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

test("spawnAcpClient launches WorkBuddy-style agents through spawnAgentProcess", () => {
  const src = readFileSync(new URL("./acp-client.mjs", import.meta.url), "utf8");
  assert.match(src, /spawnAgentProcess\(/);
  assert.doesNotMatch(src, /isWindowsCmdShim\(/);
  assert.doesNotMatch(src, /buildWindowsCmdSpawnSpec\(/);
});

test("spawnAcpClient fails immediately when the CLI is missing", async () => {
  const missing =
    process.platform === "win32"
      ? "C:\\definitely-missing-onmyagent-acp.exe"
      : "/definitely/missing/onmyagent-acp";
  const events = [];
  const { client } = spawnAcpClient({
    command: missing,
    args: [],
    appendEvent: (event) => events.push(event),
  });
  await assert.rejects(
    () => client.request("initialize", { protocolVersion: 1, clientInfo: { name: "t", version: "0" } }, 1_500),
    /ENOENT|closed|spawn|not found/i,
  );
  assert.ok(events.some((event) => event.type === "error"));
});

test("spawnAcpClient runs a shebang ACP fixture on Windows", { skip: process.platform !== "win32" }, async () => {
  const fixture = fileURLToPath(new URL("./fixtures/fake-acp-cli.mjs", import.meta.url));
  const { child, client } = spawnAcpClient({
    command: fixture,
    args: [],
    appendEvent: () => undefined,
  });
  try {
    const initialized = await Promise.race([
      client.request("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "studio-test", version: "0.0.0" },
        clientCapabilities: {},
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("ACP initialize timed out")), 5_000)),
    ]);
    assert.equal(initialized.agentInfo.name, "fake-acp-cli");
  } finally {
    client.dispose();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  }
});
