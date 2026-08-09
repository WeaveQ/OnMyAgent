import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceInfo } from "@onmyagent/types/server";
import {
  deleteSessionOrigin,
  listSessionOrigins,
  sessionOriginsPath,
  upsertSessionOrigin,
} from "../src/services/session-origins.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function workspace(id = "workspace-a"): Promise<WorkspaceInfo> {
  const path = await mkdtemp(join(tmpdir(), "onmyagent-session-origin-"));
  roots.push(path);
  return { id, name: id, path, preset: "starter", workspaceType: "local" };
}

describe("session origins", () => {
  test("persists workspace-owned origins atomically and preserves created time on upsert", async () => {
    const target = await workspace();
    const first = await upsertSessionOrigin(target, "session-1", { kind: "expert", agentId: "agent-a" });
    const second = await upsertSessionOrigin(target, "session-1", { kind: "assistant", directory: "/tmp/assistant" });

    expect(second.workspaceId).toBe(target.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect((await listSessionOrigins(target)).items).toEqual([second]);
    expect(JSON.parse(await readFile(sessionOriginsPath(target), "utf8"))).toMatchObject({ version: 1 });
  });

  test("returns an empty list for corrupted state and deletes idempotently", async () => {
    const target = await workspace();
    const path = sessionOriginsPath(target);
    await upsertSessionOrigin(target, "session-1", { kind: "automation" });
    await writeFile(path, "not json", "utf8");

    expect((await listSessionOrigins(target)).items).toEqual([]);
    await deleteSessionOrigin(target, "missing");
    await deleteSessionOrigin(target, "session-1");
    expect((await listSessionOrigins(target)).items).toEqual([]);
  });

  test("serializes concurrent writes for the same workspace", async () => {
    const target = await workspace();
    await Promise.all([
      upsertSessionOrigin(target, "session-a", { kind: "assistant" }),
      upsertSessionOrigin(target, "session-b", { kind: "automation" }),
    ]);
    expect((await listSessionOrigins(target)).items.map((item) => item.sessionId).sort()).toEqual(["session-a", "session-b"]);
  });

  test("never writes relative state for a workspace without a local path", async () => {
    const target = await workspace();
    target.path = "";
    await expect(listSessionOrigins(target)).rejects.toMatchObject({
      code: "session_origins_unavailable",
    });
  });
});
