import { describe, expect, test } from "bun:test";

import { workspaceIdForPath } from "../../server/src/workspace/workspaces.ts";
import {
  onmyagentOpencodeProxyBaseUrl,
  onmyagentServerWorkspaceIdForPath,
  resolveOnmyagentOpencodeProxyBaseUrl,
} from "../src/opencode-proxy-url.ts";
import { SANDBOX_WORKSPACE_DIR } from "../src/sandbox-constants.ts";

describe("sandbox OpenCode proxy URL", () => {
  test("uses the server workspace id, not the orchestrator local hash", () => {
    const workspacePath = "/tmp/onmyagent-workspace";
    expect(onmyagentServerWorkspaceIdForPath(workspacePath)).toBe(
      workspaceIdForPath(workspacePath),
    );
    expect(onmyagentServerWorkspaceIdForPath(workspacePath)).not.toMatch(/^ws-/);
    expect(
      onmyagentOpencodeProxyBaseUrl("http://127.0.0.1:8787/", workspacePath),
    ).toBe(
      `http://127.0.0.1:8787/workspace/${workspaceIdForPath(workspacePath)}/opencode`,
    );
  });

  test("sandbox attach URL hashes the container workspace path", () => {
    expect(SANDBOX_WORKSPACE_DIR).toBe("/workspace");
    expect(
      onmyagentOpencodeProxyBaseUrl("http://127.0.0.1:8787", SANDBOX_WORKSPACE_DIR),
    ).toBe(
      `http://127.0.0.1:8787/workspace/${workspaceIdForPath("/workspace")}/opencode`,
    );
  });

  test("prefers the live workspace id and falls back to the hashed path", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ items: [{ id: "ws_liveid12ab" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    try {
      await expect(
        resolveOnmyagentOpencodeProxyBaseUrl({
          onmyagentBaseUrl: "http://127.0.0.1:8787/",
          onmyagentToken: "token",
          fallbackWorkspacePath: SANDBOX_WORKSPACE_DIR,
        }),
      ).resolves.toBe("http://127.0.0.1:8787/workspace/ws_liveid12ab/opencode");
    } finally {
      globalThis.fetch = originalFetch;
    }

    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    try {
      await expect(
        resolveOnmyagentOpencodeProxyBaseUrl({
          onmyagentBaseUrl: "http://127.0.0.1:8787",
          onmyagentToken: "token",
          fallbackWorkspacePath: SANDBOX_WORKSPACE_DIR,
        }),
      ).resolves.toBe(
        onmyagentOpencodeProxyBaseUrl("http://127.0.0.1:8787", SANDBOX_WORKSPACE_DIR),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
