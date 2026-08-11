import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceInfo } from "@onmyagent/types/server";
import {
  aggregateWorkspaceSessionLists,
  type WorkspaceSessionAggregateSource,
} from "../src/services/workspace-sessions.js";
import { scanWorkspaceExpertSessionMarkers } from "../src/services/workspace-session-marker-inventory.js";
import {
  assertWorkspaceSessionAggregateWindow,
  MAX_WORKSPACE_SESSION_AGGREGATE_WINDOW,
  normalizeWorkspaceSessionListInput,
} from "../src/services/workspace-session-list-policy.js";
import type { SessionInfoReadModel } from "../src/services/session-read-model.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

function session(id: string, updated: number, directory = "/workspace") : SessionInfoReadModel {
  return {
    id,
    title: id,
    directory,
    time: { updated },
  };
}

function normalized(input: { start?: number; limit?: number; search?: string } = {}) {
  return normalizeWorkspaceSessionListInput({ scope: "workspace", ...input });
}

async function makeWorkspace(id = "workspace-aggregate"): Promise<WorkspaceInfo> {
  const root = await mkdtemp(join(tmpdir(), "onmyagent-workspace-aggregate-"));
  roots.push(root);
  const workspaceRoot = join(root, "repo");
  await mkdir(workspaceRoot, { recursive: true });
  return {
    id,
    name: id,
    path: workspaceRoot,
    preset: "starter",
    workspaceType: "local",
  };
}

describe("workspace session marker inventory", () => {
  test("missing runtime root is a complete empty inventory", async () => {
    const workspace = await makeWorkspace();
    const runtimeRoot = join(tmpdir(), `onmyagent-missing-runtime-${Date.now()}`);
    const result = await scanWorkspaceExpertSessionMarkers({ workspace, runtimeRoot });
    expect(result).toMatchObject({ entries: [], complete: true, failures: [] });
  });

  test("finds authorized marker directories without consulting origins", async () => {
    const workspace = await makeWorkspace();
    const runtimeRoot = await mkdtemp(join(tmpdir(), "onmyagent-runtime-"));
    roots.push(runtimeRoot);
    const workspaceSegment = createHash("sha256")
      .update(`${workspace.id}\0${workspace.path}`)
      .digest("hex")
      .slice(0, 16);
    const sessionDirectory = join(runtimeRoot, workspaceSegment, "expert-a", "session-1");
    await mkdir(sessionDirectory, { recursive: true });
    await writeFile(
      join(sessionDirectory, "onmyagent-session.json"),
      `${JSON.stringify({ kind: "expert-session", workspaceId: workspace.id, sessionKey: "session-1" })}\n`,
      "utf8",
    );

    const result = await scanWorkspaceExpertSessionMarkers({ workspace, runtimeRoot });
    expect(result.complete).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.entries).toMatchObject([
      { agentSegment: "expert-a", sessionKey: "session-1" },
    ]);
    expect(result.entries[0]?.directory).toBe(await realpath(sessionDirectory));
  });

  test("rejects a symlinked marker even when its target has matching identity", async () => {
    const workspace = await makeWorkspace();
    const runtimeRoot = await mkdtemp(join(tmpdir(), "onmyagent-runtime-"));
    roots.push(runtimeRoot);
    const workspaceSegment = createHash("sha256")
      .update(`${workspace.id}\0${workspace.path}`)
      .digest("hex")
      .slice(0, 16);
    const sessionDirectory = join(runtimeRoot, workspaceSegment, "expert-a", "session-1");
    await mkdir(sessionDirectory, { recursive: true });
    const externalMarker = join(runtimeRoot, "external-marker.json");
    await writeFile(
      externalMarker,
      `${JSON.stringify({ kind: "expert-session", workspaceId: workspace.id })}\n`,
      "utf8",
    );
    await symlink(externalMarker, join(sessionDirectory, "onmyagent-session.json"));

    const result = await scanWorkspaceExpertSessionMarkers({ workspace, runtimeRoot });
    expect(result.entries).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.failures).toMatchObject([{ code: "marker_invalid" }]);
  });

  test("bounds candidate scanning and reports one redacted budget failure", async () => {
    const workspace = await makeWorkspace();
    const runtimeRoot = await mkdtemp(join(tmpdir(), "onmyagent-runtime-"));
    roots.push(runtimeRoot);
    const workspaceSegment = createHash("sha256")
      .update(`${workspace.id}\0${workspace.path}`)
      .digest("hex")
      .slice(0, 16);
    for (const sessionKey of ["session-1", "session-2", "session-3"]) {
      const sessionDirectory = join(runtimeRoot, workspaceSegment, "expert-a", sessionKey);
      await mkdir(sessionDirectory, { recursive: true });
      await writeFile(
        join(sessionDirectory, "onmyagent-session.json"),
        `${JSON.stringify({ kind: "expert-session", workspaceId: workspace.id })}\n`,
        "utf8",
      );
    }

    const result = await scanWorkspaceExpertSessionMarkers({
      workspace,
      runtimeRoot,
      maxDirectories: 1,
    });
    expect(result.entries).toHaveLength(1);
    expect(result.complete).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      source: "expert-runtime",
      index: 1,
      code: "directory_budget_exceeded",
    });
    expect(result.failures[0]?.key).toMatch(/^[a-f0-9]{12}$/);
  });
});

describe("aggregateWorkspaceSessionLists", () => {
  test("dedupes by id, sorts by updatedAt, and applies global start/limit semantics", async () => {
    const sources: WorkspaceSessionAggregateSource[] = [
      { directory: "/workspace", source: "workspace-root", key: "root", index: 0 },
      { directory: "/runtime/expert-a", source: "expert-runtime", key: "aabbccddeeff", index: 1 },
      { directory: "/runtime/expert-b", source: "expert-runtime", key: "112233445566", index: 2 },
    ];
    const calls: Array<{ directory: string; start: number; limit: number; roots?: boolean; search?: string }> = [];
    const result = await aggregateWorkspaceSessionLists({
      sources,
      normalized: normalized({ start: 1, limit: 3, search: "needle" }),
      read: async (source, request) => {
        calls.push({
          directory: source.directory,
          start: request.start,
          limit: request.limit,
          roots: request.roots,
          search: request.search,
        });
        if (source.index === 0) return [session("root-a", 10), session("duplicate", 1), session("root-b", 5)];
        if (source.index === 1) return [session("duplicate", 20, source.directory), session("expert-c", 15, source.directory)];
        return [session("expert-d", 7, source.directory)];
      },
    });

    expect(result.scope).toBe("workspace");
    expect(result.complete).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.items.map((item) => (item as SessionInfoReadModel).id)).toEqual([
      "expert-c",
      "root-a",
      "expert-d",
    ]);
    expect(calls).toHaveLength(3);
    expect(calls.every((call) => call.start === 0 && call.limit === 4 && call.search === "needle")).toBe(true);
  });

  test("preserves roots and handles a workspace with no expert sources", async () => {
    const calls: Array<{ roots?: boolean; directory: string }> = [];
    const result = await aggregateWorkspaceSessionLists({
      sources: [{ directory: "/workspace", source: "workspace-root", key: "root", index: 0 }],
      normalized: normalizeWorkspaceSessionListInput({
        scope: "workspace",
        roots: true,
        limit: 2,
      }),
      read: async (source, request) => {
        calls.push({ directory: source.directory, roots: request.roots });
        return [session("root-only", 1)];
      },
    });

    expect(calls).toEqual([{ directory: "/workspace", roots: true }]);
    expect(result).toMatchObject({
      scope: "workspace",
      complete: true,
      failures: [],
    });
    expect(result.items).toHaveLength(1);
  });

  test("caps concurrent source reads and returns redacted partial failures", async () => {
    const sources = Array.from({ length: 9 }, (_, index) => ({
      directory: `/private/runtime/${index}`,
      source: index === 0 ? "workspace-root" as const : "expert-runtime" as const,
      key: `/private/runtime/${index}`,
      index,
    }));
    let active = 0;
    let maxActive = 0;
    const result = await aggregateWorkspaceSessionLists({
      sources,
      normalized: normalized({ limit: 10 }),
      read: async (source) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Bun.sleep(2);
        active -= 1;
        if (source.index === 3) throw new Error("simulated source failure");
        return [session(`session-${source.index}`, source.index)];
      },
    });

    expect(maxActive).toBeLessThanOrEqual(4);
    expect(result.complete).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ source: "expert-runtime", index: 3, code: "directory_read_failed" });
    expect(result.failures[0]?.key).toMatch(/^[a-f0-9]{12}$/);
    expect(result.failures[0]?.key).not.toContain("private");
  });

  test("propagates abort to source reads", async () => {
    const controller = new AbortController();
    const sources: WorkspaceSessionAggregateSource[] = [
      { directory: "/workspace", source: "workspace-root", key: "root", index: 0 },
    ];
    const aggregate = aggregateWorkspaceSessionLists({
      sources,
      normalized: normalized(),
      signal: controller.signal,
      read: async (_source, request) => new Promise<SessionInfoReadModel[]>((_resolve, reject) => {
        request.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }),
    });
    controller.abort();
    await expect(aggregate).rejects.toMatchObject({ name: "AbortError" });
  });

  test("rejects an oversized aggregate window instead of silently clamping", () => {
    const input = normalizeWorkspaceSessionListInput({
      scope: "workspace",
      start: MAX_WORKSPACE_SESSION_AGGREGATE_WINDOW - 10,
      limit: 10,
    });
    expect(() => assertWorkspaceSessionAggregateWindow(input)).not.toThrow();
    const tooLarge = normalizeWorkspaceSessionListInput({
      scope: "workspace",
      start: MAX_WORKSPACE_SESSION_AGGREGATE_WINDOW - 10,
      limit: 12,
    });
    expect(() => assertWorkspaceSessionAggregateWindow(tooLarge)).toThrow(
      /session aggregate window/i,
    );
  });
});
