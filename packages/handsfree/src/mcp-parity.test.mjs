import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(readFileSync(
  path.join(packageRoot, "fixtures", "codex-computer-use-tools-list.json"),
  "utf8",
));
const recordAndReplayFixture = JSON.parse(readFileSync(
  path.join(packageRoot, "fixtures", "codex-record-and-replay-tools-list.json"),
  "utf8",
));
const skysightFixture = JSON.parse(readFileSync(
  path.join(packageRoot, "fixtures", "codex-skysight-tools-list.json"),
  "utf8",
));

function helperPath() {
  const buildRoot = path.join(packageRoot, "native", "HandsFree", ".build");
  return [
    path.join(buildRoot, "debug", "HandsFreeComputerUse"),
    path.join(buildRoot, "arm64-apple-macosx", "debug", "HandsFreeComputerUse"),
    path.join(buildRoot, "release", "HandsFreeComputerUse"),
    path.join(buildRoot, "arm64-apple-macosx", "release", "HandsFreeComputerUse"),
  ].find(existsSync);
}

function toolsList(binary) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["mcp"], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out waiting for tools/list. ${stderr}`));
    }, 5_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const message = JSON.parse(line);
      if (message.id !== 2) return;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      resolve(message.result.tools);
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "parity-test", version: "1" } },
    })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  });
}

function callTool(binary, name, args = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["mcp"], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Timed out waiting for ${name}. ${stderr}`));
    }, 10_000);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      const message = JSON.parse(line);
      if (message.id !== 2) return;
      clearTimeout(timeout);
      child.kill("SIGTERM");
      resolve(message.result);
    });
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "parity-test", version: "1" } },
    })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    child.stdin.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    })}\n`);
  });
}

test("Sky tool surface matches the sanitized observed Codex fixture", async () => {
  const binary = helperPath();
  assert.ok(binary, "Build the native Computer Use helper before running parity tests");
  const tools = await toolsList(binary);
  const expectedNames = new Set(fixture.tools.map((tool) => tool.name));
  const projection = tools
    .filter((tool) => expectedNames.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      required: [...(tool.inputSchema.required ?? [])].sort(),
      properties: Object.keys(tool.inputSchema.properties).sort(),
      types: Object.fromEntries(Object.entries(tool.inputSchema.properties).map(([name, schema]) => [name, schema.type])),
      enums: Object.fromEntries(Object.entries(tool.inputSchema.properties).filter(([, schema]) => Array.isArray(schema.enum)).map(([name, schema]) => [name, schema.enum])),
      readOnly: tool.annotations.readOnlyHint,
      idempotent: tool.annotations.idempotentHint,
      additionalProperties: tool.inputSchema.additionalProperties,
      destructive: tool.annotations.destructiveHint,
      openWorld: tool.annotations.openWorldHint,
    }));
  const expected = fixture.tools.map((tool) => ({
    ...tool,
    required: [...tool.required].sort(),
    properties: [...tool.properties].sort(),
    idempotent: tool.readOnly,
    additionalProperties: false,
    destructive: false,
    openWorld: false,
  }));
  assert.deepEqual(projection, expected);
});

test("list_apps is callable through the live MCP transport without UI permissions", async () => {
  const binary = helperPath();
  assert.ok(binary, "Build the native Computer Use helper before running parity tests");
  const result = await callTool(binary, "list_apps");
  assert.equal(result.content.length, 1);
  assert.equal(result.content[0].type, "text");
  const payload = JSON.parse(result.content[0].text);
  assert.ok(Array.isArray(payload.apps));
  assert.ok(payload.apps.length > 0, "Expected at least one installed or running Mac app");
  for (const app of payload.apps) {
    assert.equal(typeof app.id, "string");
    assert.equal(typeof app.isRunning, "boolean");
  }
});

test("Record & Replay tool surface matches the observed Codex subserver", async () => {
  const binary = helperPath();
  assert.ok(binary, "Build the native Computer Use helper before running parity tests");
  const tools = await toolsList(binary);
  const expectedNames = new Set(recordAndReplayFixture.tools.map((tool) => tool.name));
  const projection = tools
    .filter((tool) => expectedNames.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      readOnly: tool.annotations.readOnlyHint,
      idempotent: tool.annotations.idempotentHint,
      destructive: tool.annotations.destructiveHint,
      openWorld: tool.annotations.openWorldHint,
      additionalProperties: tool.inputSchema.additionalProperties,
      properties: Object.keys(tool.inputSchema.properties),
    }));
  const expected = recordAndReplayFixture.tools.map((tool) => ({
    ...tool,
    destructive: false,
    openWorld: false,
    additionalProperties: false,
    properties: [],
  }));
  assert.deepEqual(projection, expected);
});

test("Skysight tool surface matches the reverse-audited Codex subserver", async () => {
  const binary = helperPath();
  assert.ok(binary, "Build the native Computer Use helper before running parity tests");
  const tools = await toolsList(binary);
  const expectedNames = new Set(skysightFixture.tools.map((tool) => tool.name));
  const projection = tools
    .filter((tool) => expectedNames.has(tool.name))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      required: [...(tool.inputSchema.required ?? [])].sort(),
      properties: Object.keys(tool.inputSchema.properties).sort(),
      readOnly: tool.annotations.readOnlyHint,
      idempotent: tool.annotations.idempotentHint,
      destructive: tool.annotations.destructiveHint,
      openWorld: tool.annotations.openWorldHint,
      additionalProperties: tool.inputSchema.additionalProperties,
    }));
  const expected = skysightFixture.tools.map((tool) => ({
    ...tool,
    required: [...tool.required].sort(),
    properties: [...tool.properties].sort(),
    destructive: false,
    openWorld: false,
    additionalProperties: false,
  }));
  assert.deepEqual(projection, expected);
});
