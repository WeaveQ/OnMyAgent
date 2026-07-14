import { randomBytes } from "node:crypto";
import http from "node:http";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_json_body");
  }
  return value;
}

function validMessages(value) {
  return Array.isArray(value) && value.length > 0 && value.every((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return false;
    if (!["system", "user", "assistant"].includes(message.role)) return false;
    return typeof message.content === "string" || Array.isArray(message.content);
  });
}

export function createBrowserUseModelGateway({ invokeModel }) {
  if (typeof invokeModel !== "function") {
    throw new Error("Browser Use model gateway requires invokeModel");
  }
  const runsByToken = new Map();
  let server = null;
  let baseUrl = "";

  function runForRequest(request) {
    const header = String(request.headers.authorization ?? "");
    const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header);
    return match ? runsByToken.get(match[1]) ?? null : null;
  }

  async function handle(request, response) {
    const run = runForRequest(request);
    if (!run) {
      json(response, 401, { error: "unauthorized" });
      return;
    }
    const url = new URL(request.url ?? "/", baseUrl);
    if (request.method === "GET" && url.pathname === "/v1/health") {
      json(response, 200, { ready: true });
      return;
    }
    if (request.method !== "POST" || url.pathname !== "/v1/invoke") {
      json(response, 404, { error: "not_found" });
      return;
    }

    let body;
    try {
      body = await readJson(request);
    } catch (error) {
      json(response, error instanceof Error && error.message === "request_too_large" ? 413 : 400, {
        error: "invalid_request",
      });
      return;
    }
    if (!validMessages(body.messages)) {
      json(response, 400, { error: "messages_required" });
      return;
    }
    if (
      body.outputSchema !== undefined &&
      (!body.outputSchema || typeof body.outputSchema !== "object" || Array.isArray(body.outputSchema))
    ) {
      json(response, 400, { error: "invalid_output_schema" });
      return;
    }

    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    response.once("close", () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      const result = await invokeModel({
        ownerId: run.ownerId,
        model: run.model,
        messages: body.messages,
        outputSchema: body.outputSchema ?? null,
        signal: controller.signal,
      });
      if (!response.writableEnded && !response.destroyed) {
        json(response, 200, {
          value: result?.value ?? null,
          ...(result?.usage ? { usage: result.usage } : {}),
        });
      }
    } catch (error) {
      if (!response.writableEnded && !response.destroyed) {
        json(response, controller.signal.aborted ? 499 : 502, {
          error: controller.signal.aborted ? "cancelled" : "model_error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  async function start() {
    if (server) return status();
    server = http.createServer((request, response) => {
      void handle(request, response);
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, LOOPBACK_HOST, resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Model gateway failed to bind");
    baseUrl = `http://${LOOPBACK_HOST}:${address.port}`;
    return status();
  }

  async function stop() {
    const active = server;
    server = null;
    baseUrl = "";
    runsByToken.clear();
    if (!active) return;
    await new Promise((resolve) => active.close(resolve));
  }

  function environmentForRun({ ownerId, model }) {
    if (!server || !baseUrl) throw new Error("Browser Use model gateway is not running");
    const token = randomBytes(32).toString("base64url");
    runsByToken.set(token, { ownerId: String(ownerId), model: model ?? null });
    return {
      ONMYAGENT_MODEL_GATEWAY_URL: baseUrl,
      ONMYAGENT_MODEL_GATEWAY_TOKEN: token,
    };
  }

  function releaseRun(environment) {
    const token = environment?.ONMYAGENT_MODEL_GATEWAY_TOKEN;
    if (typeof token === "string") runsByToken.delete(token);
  }

  function status() {
    return { ready: Boolean(server && baseUrl), activeRuns: runsByToken.size };
  }

  return { start, stop, status, environmentForRun, releaseRun };
}
