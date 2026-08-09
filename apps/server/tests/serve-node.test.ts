import { describe, expect, test } from "bun:test";
import { Agent, request as nodeRequest } from "node:http";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { serve } from "../src/serve-node.js";

describe("serve", () => {
  test("does not write an error response after a streaming response has ended", async () => {
    const uncaught: unknown[] = [];
    const onUncaughtException = (error: unknown) => {
      uncaught.push(error);
    };
    process.on("uncaughtException", onUncaughtException);

    const encoder = new TextEncoder();
    const server = await serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        if (new URL(request.url).pathname === "/health") {
          return Response.json({ ok: true });
        }

        let wroteChunk = false;
        return new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              if (!wroteChunk) {
                wroteChunk = true;
                controller.enqueue(encoder.encode("partial"));
                return;
              }
              controller.error(new Error("stream failed after response started"));
            },
          }),
        );
      },
    });

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/stream`);
      await response.text().catch(() => undefined);
      await delay(25);

      expect(uncaught).toEqual([]);

      const health = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ ok: true });
    } finally {
      process.off("uncaughtException", onUncaughtException);
      await server.stop();
    }
  });

  test("aborts and cancels a response stream when the TCP client disconnects", async () => {
    let aborted = false;
    let cancelCalls = 0;
    let activeResources = 0;
    let releaseResource = () => undefined;
    const encoder = new TextEncoder();
    const server = await serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        activeResources += 1;
        let released = false;
        releaseResource = () => {
          if (released) return;
          released = true;
          activeResources -= 1;
        };
        request.signal.addEventListener("abort", () => {
          aborted = true;
          releaseResource();
        }, { once: true });
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("connected"));
          },
          cancel() {
            cancelCalls += 1;
            releaseResource();
          },
        }));
      },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const socket = connect({ host: "127.0.0.1", port: server.port });
        socket.once("error", reject);
        socket.once("connect", () => {
          socket.write("GET /stream HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n");
        });
        socket.once("data", () => {
          socket.destroy();
          resolve();
        });
      });

      await delay(25);

      expect(aborted).toBe(true);
      expect(cancelCalls).toBe(1);
      expect(activeResources).toBe(0);
    } finally {
      releaseResource();
      await server.stop();
    }
  });

  test("keeps a completed request alive across a normal keep-alive connection reuse", async () => {
    const signals: AbortSignal[] = [];
    const server = await serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: (request) => {
        signals.push(request.signal);
        return Response.json({ request: signals.length });
      },
    });
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    const get = () => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = nodeRequest({
        hostname: "127.0.0.1",
        port: server.port,
        path: "/health",
        method: "GET",
        agent,
      }, (response) => {
        const chunks: Uint8Array[] = [];
        response.on("data", (chunk: Uint8Array) => chunks.push(chunk));
        response.once("error", reject);
        response.once("end", () => {
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") });
        });
      });
      request.once("error", reject);
      request.end();
    });

    try {
      const first = await get();
      expect(first.status).toBe(200);
      expect(first.body).toBe('{"request":1}');
      expect(signals).toHaveLength(1);
      expect(signals[0]?.aborted).toBe(false);

      const second = await get();
      expect(second.status).toBe(200);
      expect(second.body).toBe('{"request":2}');
      expect(signals).toHaveLength(2);
      expect(signals[0]?.aborted).toBe(false);
      expect(signals[1]?.aborted).toBe(false);
    } finally {
      agent.destroy();
      await server.stop();
    }
  });

  test("awaits shutdown before resolving stop", async () => {
    const first = await serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ ok: true }),
    });
    const port = first.port;

    await first.stop();

    const second = await serve({
      hostname: "127.0.0.1",
      port,
      fetch: () => Response.json({ ok: true }),
    });
    expect(second.port).toBe(port);
    await second.stop();
  });

  test("reuses the in-flight shutdown for repeated stop calls", async () => {
    const first = await serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ ok: true }),
    });
    const port = first.port;

    await Promise.all([first.stop(), first.stop()]);

    const second = await serve({
      hostname: "127.0.0.1",
      port,
      fetch: () => Response.json({ ok: true }),
    });
    expect(second.port).toBe(port);
    await second.stop();
  });
});
