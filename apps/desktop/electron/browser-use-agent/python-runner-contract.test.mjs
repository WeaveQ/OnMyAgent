import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const target = process.platform === "darwin" && process.arch === "arm64"
  ? "aarch64-apple-darwin"
  : process.platform === "darwin"
    ? "x86_64-apple-darwin"
    : process.platform === "linux" && process.arch === "arm64"
      ? "aarch64-unknown-linux-gnu"
      : "x86_64-unknown-linux-gnu";
const python = path.join(
  desktopRoot,
  "resources",
  "runtimes",
  target,
  "python",
  process.platform === "win32" ? "python.exe" : "bin/python3",
);
const resources = path.join(desktopRoot, "resources", "browser-use-agent");

function runPython(args, options) {
  return new Promise((resolve) => {
    const child = spawn(python, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

test("OnMyAgentChatModel serializes images and validates structured output", async () => {
  let received = null;
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const body = JSON.stringify({
        value: { next_goal: "inspect", confidence: 0.9 },
        usage: { inputTokens: 12, outputTokens: 4 },
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(body);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const code = [
      "import asyncio, json",
      "from pydantic import BaseModel",
      "from browser_use.llm.messages import UserMessage, ContentPartTextParam, ContentPartImageParam, ImageURL",
      "from onmyagent_chat_model import OnMyAgentChatModel",
      "class Output(BaseModel):",
      "    next_goal: str",
      "    confidence: float",
      "async def main():",
      "    llm = OnMyAgentChatModel()",
      "    message = UserMessage(content=[ContentPartTextParam(text='inspect'), ContentPartImageParam(image_url=ImageURL(url='data:image/png;base64,AA=='))])",
      "    result = await llm.ainvoke([message], Output)",
      "    print(json.dumps({'completion': result.completion.model_dump(), 'usage': result.usage.model_dump()}))",
      "asyncio.run(main())",
    ].join("\n");
    const result = await runPython(["-c", code], {
      cwd: resources,
      env: {
        ...process.env,
        PYTHONPATH: resources,
        ONMYAGENT_MODEL_GATEWAY_URL: `http://127.0.0.1:${address.port}`,
        ONMYAGENT_MODEL_GATEWAY_TOKEN: "test-token",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(result.status, 0, result.stderr);
    const output = JSON.parse(result.stdout.trim());
    assert.deepEqual(output.completion, { next_goal: "inspect", confidence: 0.9 });
    assert.equal(output.usage.prompt_tokens, 12);
    const receivedJson = JSON.stringify(received);
    assert.match(receivedJson, /"title":"Output"/);
    assert.match(receivedJson, /"type":"image_url"/);
    assert.match(receivedJson, /data:image\/png;base64,AA==/);
    assert.doesNotMatch(receivedJson, /test-token/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("runner describes an upstream browser_use.Agent entrypoint", () => {
  const result = spawnSync(python, [path.join(resources, "runner.py"), "--describe"], {
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    agentClass: "browser_use.Agent",
    browserClass: "browser_use.BrowserSession",
    modelClass: "OnMyAgentChatModel",
    protocol: "jsonl-v1",
  });
});

test("runner approval policy detects explicit writes and risky DOM clicks", () => {
  const code = [
    "import json",
    "from runner import approval_reason",
    "cases = [",
    "  approval_reason('upload_file', {'path': '/tmp/a'}, ''),",
    "  approval_reason('click', {'index': 7}, '发布笔记'),",
    "  approval_reason('click', {'index': 8}, '展开详情'),",
    "]",
    "print(json.dumps(cases, ensure_ascii=False))",
  ].join("\n");
  const result = spawnSync(python, ["-c", code], {
    cwd: resources,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resources },
  });
  assert.equal(result.status, 0, result.stderr);
  const reasons = JSON.parse(result.stdout);
  assert.match(reasons[0], /upload_file/);
  assert.match(reasons[1], /发布/);
  assert.equal(reasons[2], null);
});
