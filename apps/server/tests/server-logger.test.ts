import { afterEach, describe, expect, test } from "bun:test";
import type { ServerConfig } from "@onmyagent/types/server";

import { createServerLogger } from "../src/server.js";

const originalWrite = process.stdout.write;

function config(logFormat: ServerConfig["logFormat"]): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    token: "test-client-token",
    hostToken: "test-host-token",
    approval: { mode: "auto", timeoutMs: 30000 },
    corsOrigins: ["*"],
    workspaces: [],
    authorizedRoots: [],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat,
    logRequests: true,
  } as ServerConfig;
}

function epipeError() {
  const error = new Error("write EPIPE");
  Object.defineProperty(error, "code", { value: "EPIPE" });
  return error;
}

afterEach(() => {
  process.stdout.write = originalWrite;
});

describe("createServerLogger", () => {
  test("does not throw when pretty stdout logging hits EPIPE", () => {
    process.stdout.write = (() => {
      throw epipeError();
    }) as typeof process.stdout.write;

    const logger = createServerLogger(config("pretty"));

    expect(() => logger.log("info", "GET /health 200 1ms")).not.toThrow();
  });

  test("does not throw when json stdout logging hits EPIPE", () => {
    process.stdout.write = (() => {
      throw epipeError();
    }) as typeof process.stdout.write;

    const logger = createServerLogger(config("json"));

    expect(() => logger.log("info", "GET /health 200 1ms")).not.toThrow();
  });

  test("does not throw when stdout emits EPIPE after logging", () => {
    process.stdout.write = (() => true) as typeof process.stdout.write;

    const logger = createServerLogger(config("pretty"));
    logger.log("info", "GET /health 200 1ms");

    expect(() => process.stdout.emit("error", epipeError())).not.toThrow();
  });
});
