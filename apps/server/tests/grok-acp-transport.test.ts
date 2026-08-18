import { afterEach, describe, expect, test } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { GrokAcpTransport } from "../src/services/grok-acp-transport.js";

const children: ChildProcessWithoutNullStreams[] = [];
afterEach(() => { for (const child of children.splice(0)) child.kill("SIGKILL"); });
function fixture(input: {
  onNotification?: (method: string, params: unknown) => void;
  onRequest?: (method: string, params: unknown) => Promise<unknown>;
} = {}) {
  const child = spawn(process.execPath, [join(import.meta.dir, "fixtures/fake-grok-acp.mjs")], { stdio: ["pipe", "pipe", "pipe"] });
  children.push(child);
  return new GrokAcpTransport({ child, ...input });
}

describe("GrokAcpTransport", () => {
  test("frames requests, ignores malformed lines and forwards unknown notifications", async () => {
    const methods: string[] = [];
    const transport = fixture({ onNotification: (method) => methods.push(method) });
    await expect(transport.request("echo", {})).resolves.toEqual({ ok: true });
    expect(methods).toEqual(["x.ai/unknown"]);
  });
  test("maps reverse permission requests without exposing remote error details", async () => {
    const transport = fixture({ onRequest: async (method) => ({ outcome: method === "session/request_permission" ? "selected" : "cancelled" }) });
    await expect(transport.request("permission", {})).resolves.toEqual({ outcome: "selected" });
    await expect(transport.request("error", {})).rejects.toMatchObject({ code: "grok_acp_remote_error", message: "Grok ACP error failed" });
    await expect(transport.request("auth-error", {})).rejects.toMatchObject({
      code: "grok_auth_required",
      message: "Grok authentication is required",
    });
  });
  test("times out and rejects pending work on dispose", async () => {
    const transport = fixture();
    await expect(transport.request("hang", {}, 10)).rejects.toMatchObject({ code: "grok_acp_request_timeout" });
    const pending = transport.request("hang", {}, 60_000);
    transport.dispose();
    await expect(pending).rejects.toMatchObject({ code: "grok_acp_transport_disposed" });
  });
  test("writes JSON-RPC notifications without allocating a pending request", async () => {
    const observed = new Promise<unknown>((resolve) => {
      const transport = fixture({
        onNotification(method, params) {
          if (method === "cancel/observed") resolve(params);
        },
      });
      void transport.notify("session/cancel", { sessionId: "native" });
    });
    await expect(observed).resolves.toEqual({ sessionId: "native" });
  });
  test("drops an oversized frame and recovers at the next newline", async () => {
    const transport = fixture();
    await expect(transport.request("oversized", {})).resolves.toEqual({ ok: true });
    await expect(transport.request("echo", {})).resolves.toEqual({ ok: true });
  });
});
