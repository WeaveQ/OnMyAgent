import { describe, expect, test } from "bun:test";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { ApiError } from "../src/core/errors.js";
import { createOpencodeEngineReloader } from "../src/services/opencode-engine-reload.js";

const workspace: WorkspaceInfo = {
  id: "workspace-reload",
  name: "Reload workspace",
  path: "/tmp/reload-workspace",
  workspaceType: "local",
  baseUrl: "http://127.0.0.1:4096",
};

const config: ServerConfig = {
  host: "127.0.0.1",
  port: 0,
  token: "test-token",
  approval: { mode: "auto", timeoutMs: 1_000 },
  corsOrigins: [],
  workspaces: [workspace],
  authorizedRoots: [workspace.path],
  readOnly: false,
  startedAt: Date.now(),
  tokenSource: "cli",
  logFormat: "pretty",
  logRequests: false,
};

describe("OpenCode engine reloader", () => {
  test("shares concurrent reloads per workspace and invalidates clients after completion", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let clears = 0;
    const reloader = createOpencodeEngineReloader({
      fetch: async () => {
        calls += 1;
        await gate;
        return Response.json({ ok: true });
      },
      clearClients: () => {
        clears += 1;
      },
    });

    const first = reloader.reload(config, workspace);
    const second = reloader.reload(config, workspace);
    expect(first).toBe(second);
    expect(calls).toBe(1);
    release?.();
    await Promise.all([first, second]);
    expect(clears).toBe(1);
  });

  test("aborts a stalled reload at its deadline and invalidates clients", async () => {
    let clears = 0;
    const reloader = createOpencodeEngineReloader({
      timeoutMs: 10,
      fetch: (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
      clearClients: () => {
        clears += 1;
      },
    });

    try {
      await reloader.reload(config, workspace);
      throw new Error("expected reload timeout");
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      expect(error.status).toBe(504);
      expect(error.code).toBe("opencode_reload_timeout");
    }
    expect(clears).toBe(1);
  });
});
