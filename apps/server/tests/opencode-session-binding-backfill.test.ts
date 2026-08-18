import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { backfillWorkspaceOpencodeSessionBindings } from "../src/services/opencode-session-binding-backfill.js";
import { OPENCODE_SESSION_BACKFILL_MAX } from "../src/services/opencode-session-binding-backfill.js";
import { ensurePrimaryOpencodeHostIdentity } from "../src/services/primary-runtime-host-state.js";
import { resolveRuntimeSessionBindingStorePath } from "../src/services/runtime-session-bindings.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "onmyagent-binding-backfill-"));
  roots.push(root);
  const workspace: WorkspaceInfo = {
    id: "workspace-a",
    name: "Workspace A",
    path: join(root, "workspace"),
    preset: "starter",
    workspaceType: "local",
  };
  const config = {
    workspaces: [workspace],
  } as ServerConfig;
  return { root, workspace, config };
}

describe("backfillWorkspaceOpencodeSessionBindings", () => {
  test("does not guess a runtime identity when composition has not provided one", async () => {
    const target = await fixture();
    let inventoryReads = 0;
    await expect(backfillWorkspaceOpencodeSessionBindings({
      ...target,
      dataRoot: target.root,
      readInventory: async () => {
        inventoryReads += 1;
        return [];
      },
    })).resolves.toEqual({
      complete: false,
      added: 0,
      failures: [],
      skipped: "runtime_identity_unavailable",
    });
    expect(inventoryReads).toBe(0);
  });

  test("binds only a complete verified native inventory and remains idempotent", async () => {
    const target = await fixture();
    await ensurePrimaryOpencodeHostIdentity({
      dataRoot: target.root,
      identity: {
        profileId: "managed",
        runtimeHome: join(target.root, "opencode-data"),
        sandboxProfile: "desktop-managed",
      },
    });
    const readInventory = async () => ([{
        id: "native-session-a",
        directory: target.workspace.path,
        time: { created: 1_700_000_000_000, updated: 1_700_000_000_001 },
      }]);
    await expect(backfillWorkspaceOpencodeSessionBindings({
      ...target,
      dataRoot: target.root,
      readInventory,
    })).resolves.toMatchObject({ complete: true, added: 1, skipped: null });
    await expect(backfillWorkspaceOpencodeSessionBindings({
      ...target,
      dataRoot: target.root,
      readInventory,
    })).resolves.toMatchObject({ complete: true, added: 0, skipped: null });
    const persisted = JSON.parse(await readFile(
      resolveRuntimeSessionBindingStorePath({
        workspace: target.workspace,
        dataRoot: target.root,
      }),
      "utf8",
    ));
    expect(persisted.bindings).toEqual([expect.objectContaining({
      productSessionId: "native-session-a",
      runtimeKind: "opencode",
      runtimeSessionId: "native-session-a",
      profileId: "managed",
      sandboxProfile: "desktop-managed",
      source: "legacy-opencode-backfill",
    })]);
  });

  test("writes nothing when a session identity is incomplete or inventory is truncated", async () => {
    const target = await fixture();
    await ensurePrimaryOpencodeHostIdentity({
      dataRoot: target.root,
      identity: {
        profileId: "managed",
        runtimeHome: join(target.root, "opencode-data"),
      },
    });
    for (const inventory of [
      [{ id: "missing-created-at", directory: target.workspace.path }],
      Array.from({ length: OPENCODE_SESSION_BACKFILL_MAX + 1 }, (_, index) => ({
        id: `session-${index}`,
        directory: target.workspace.path,
        time: { created: index + 1 },
      })),
    ]) {
      await expect(backfillWorkspaceOpencodeSessionBindings({
        ...target,
        dataRoot: target.root,
        readInventory: async () => inventory,
      })).resolves.toMatchObject({
        complete: false,
        added: 0,
        skipped: "session_inventory_incomplete",
      });
    }
    await expect(readFile(resolveRuntimeSessionBindingStorePath({
      workspace: target.workspace,
      dataRoot: target.root,
    }), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
