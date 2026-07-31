import { describe, expect, test } from "bun:test";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { createOpencodeClientPool } from "../src/services/opencode-client-pool.js";

const workspace = (
  id: string,
  baseUrl = "http://127.0.0.1:9000",
): WorkspaceInfo =>
  ({
    id,
    path: `/ws/${id}`,
    workspaceType: "local",
    baseUrl,
  }) as WorkspaceInfo;

const config = {} as ServerConfig;

describe("opencode client pool (shipped)", () => {
  test("reuses client for same workspace+directory and bounds size", () => {
    let creates = 0;
    const pool = createOpencodeClientPool({
      maxEntries: 2,
      create: (_config, ws, dir) => {
        creates += 1;
        return { id: `${ws.id}:${dir ?? ws.path}`, n: creates } as never;
      },
    });

    const a1 = pool.get(config, workspace("w1"), "/out/a");
    const a2 = pool.get(config, workspace("w1"), "/out/a");
    expect(a1).toBe(a2);
    expect(creates).toBe(1);

    pool.get(config, workspace("w2"), "/out/b");
    expect(creates).toBe(2);
    pool.get(config, workspace("w3"), "/out/c");
    expect(creates).toBe(3);
    // maxEntries=2 → oldest dropped; size stays capped
    expect(pool.size()).toBe(2);

    pool.clear();
    expect(pool.size()).toBe(0);
  });

  test("clearWorkspace drops only that workspace's entries", () => {
    let creates = 0;
    const pool = createOpencodeClientPool({
      maxEntries: 8,
      create: (_config, ws, dir) => {
        creates += 1;
        return { id: `${ws.id}:${dir ?? ws.path}`, n: creates } as never;
      },
    });

    pool.get(config, workspace("w1"), "/a");
    pool.get(config, workspace("w1"), "/b");
    pool.get(config, workspace("w2"), "/c");
    expect(pool.size()).toBe(3);

    pool.clearWorkspace("w1");
    expect(pool.size()).toBe(1);
    // surviving entry is w2
    const surviving = pool.get(config, workspace("w2"), "/c");
    expect((surviving as { n: number }).n).toBe(3);
    expect(creates).toBe(3);

    // next w1 acquire creates fresh client
    pool.get(config, workspace("w1"), "/a");
    expect(creates).toBe(4);
  });

  test("baseUrl change creates a fresh client (OpenCode port restart)", () => {
    let creates = 0;
    const pool = createOpencodeClientPool({
      maxEntries: 8,
      create: (_config, ws) => {
        creates += 1;
        return { id: `${ws.id}:${ws.baseUrl}`, n: creates } as never;
      },
    });

    const first = pool.get(config, workspace("w1", "http://127.0.0.1:1111"), "/a");
    const same = pool.get(config, workspace("w1", "http://127.0.0.1:1111"), "/a");
    expect(first).toBe(same);
    expect(creates).toBe(1);

    const afterRestart = pool.get(
      config,
      workspace("w1", "http://127.0.0.1:2222"),
      "/a",
    );
    expect(afterRestart).not.toBe(first);
    expect(creates).toBe(2);
    expect((afterRestart as { id: string }).id).toContain("2222");
  });
});
