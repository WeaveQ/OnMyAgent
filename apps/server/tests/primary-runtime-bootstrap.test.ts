import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import {
  preparePrimaryRuntimeBootstrap,
  readPrimaryOpencodeRuntimeIdentity,
  stopPrimaryRuntimeHostLifecycle,
  type PrimaryRuntimeBackfillReport,
} from "../src/services/primary-runtime-bootstrap.js";
import { resolvePrimaryRuntimeHostStatePath } from "../src/services/primary-runtime-host-state.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function fixture(workspaceCount = 2, readOnly = false) {
  const root = await mkdtemp(join(tmpdir(), "onmyagent-bootstrap-"));
  roots.push(root);
  const workspaces = Array.from({ length: workspaceCount }, (_, index): WorkspaceInfo => ({
    id: `workspace-${index}`,
    name: `Workspace ${index}`,
    path: join(root, `workspace-${index}`),
    preset: "starter",
    workspaceType: "local",
  }));
  const config = { workspaces, readOnly } as ServerConfig;
  return { root, dataRoot: join(root, "primary-state"), config };
}

describe("primary runtime bootstrap", () => {
  test("strictly parses the private host identity environment", async () => {
    await expect(readPrimaryOpencodeRuntimeIdentity({})).resolves.toBeNull();
    await expect(readPrimaryOpencodeRuntimeIdentity({
      ONMYAGENT_PRIMARY_OPENCODE_PROFILE_ID: "managed",
    })).rejects.toMatchObject({ code: "primary_runtime_host_policy_invalid" });
    await expect(readPrimaryOpencodeRuntimeIdentity({
      ONMYAGENT_PRIMARY_OPENCODE_PROFILE_ID: "managed",
      ONMYAGENT_PRIMARY_OPENCODE_RUNTIME_HOME: "/runtime/home/",
      ONMYAGENT_PRIMARY_OPENCODE_SANDBOX_PROFILE: "sandbox",
    })).resolves.toEqual({
      profileId: "managed",
      runtimeHome: "/runtime/home",
      sandboxProfile: "sandbox",
    });
  });

  test("readonly mode acquires no ownership, writes nothing, and reports a typed skip", async () => {
    const target = await fixture(1, true);
    let ownershipCalls = 0;
    const reports: PrimaryRuntimeBackfillReport[] = [];
    const handle = await preparePrimaryRuntimeBootstrap({
      ...target,
      opencodeRuntimeIdentity: {
        profileId: "managed",
        runtimeHome: join(target.root, "opencode-home"),
      },
      delayMs: 0,
      onReport: (report) => reports.push(report),
      acquireOwnership: async () => {
        ownershipCalls += 1;
        throw new Error("must not acquire");
      },
    });
    handle.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    await handle.cancelBackfill();
    await handle.release();
    expect(ownershipCalls).toBe(0);
    expect(reports).toEqual([expect.objectContaining({
      code: "primary_runtime_binding_backfill_skipped",
      reasonCounts: { server_read_only: 1 },
    })]);
    await expect(readFile(resolvePrimaryRuntimeHostStatePath(target.dataRoot)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  test("reports exact multi-workspace counts without raw paths", async () => {
    const target = await fixture(3);
    const reports: PrimaryRuntimeBackfillReport[] = [];
    let call = 0;
    const handle = await preparePrimaryRuntimeBootstrap({
      ...target,
      opencodeRuntimeIdentity: {
        profileId: "managed",
        runtimeHome: join(target.root, "secret-native-home"),
      },
      delayMs: 0,
      onReport: (report) => reports.push(report),
      backfillWorkspace: async () => {
        call += 1;
        if (call === 3) throw new Error(`do not log ${target.root}`);
        return call === 1
          ? { complete: true, added: 2, failures: [], skipped: null }
          : {
              complete: false,
              added: 0,
              failures: [{ index: 0, code: "conflicting_existing_binding" }],
              skipped: null,
            };
      },
    });
    handle.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await handle.cancelBackfill();
    await handle.release();
    expect(reports).toEqual([{
      level: "warn",
      code: "primary_runtime_binding_backfill_incomplete",
      counts: {
        workspacesTotal: 3,
        workspacesProcessed: 3,
        workspacesIncomplete: 2,
        bindingsAdded: 2,
        failures: 2,
      },
      reasonCounts: {
        conflicting_existing_binding: 1,
        workspace_backfill_failed: 1,
      },
    }]);
    expect(JSON.stringify(reports)).not.toContain(target.root);
  });

  test("stop aborts and awaits a running backfill", async () => {
    const target = await fixture(1);
    let settled = false;
    const handle = await preparePrimaryRuntimeBootstrap({
      ...target,
      opencodeRuntimeIdentity: {
        profileId: "managed",
        runtimeHome: join(target.root, "opencode-home"),
      },
      delayMs: 0,
      onReport: () => undefined,
      backfillWorkspace: ({ signal }) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          setTimeout(() => {
            settled = true;
            reject(new DOMException("Aborted", "AbortError"));
          }, 5);
        }, { once: true });
      }),
    });
    handle.start();
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
    await handle.cancelBackfill();
    expect(settled).toBe(true);
    await handle.release();
  });

  test("shared shutdown holds ownership until server and managed owners stop", async () => {
    const order: string[] = [];
    await stopPrimaryRuntimeHostLifecycle({
      bootstrap: {
        cancelBackfill: async () => { order.push("cancel"); },
        start: () => undefined,
        release: async () => { order.push("release"); },
      },
      stopServerOwners: async () => { order.push("server"); },
      stopManagedRuntime: () => { order.push("managed"); },
    });
    expect(order).toEqual(["cancel", "server", "managed", "release"]);
  });

  test("shared shutdown attempts every owner but retains the lock on failure", async () => {
    const order: string[] = [];
    await expect(stopPrimaryRuntimeHostLifecycle({
      bootstrap: {
        cancelBackfill: async () => {
          order.push("cancel");
          throw new Error("cancel failed");
        },
        start: () => undefined,
        release: async () => { order.push("release"); },
      },
      stopServerOwners: async () => { order.push("server"); },
      stopManagedRuntime: () => { order.push("managed"); },
    })).rejects.toThrow("cancel failed");
    expect(order).toEqual(["cancel", "server", "managed"]);
  });

  test("releases ownership when identity persistence fails during prepare", async () => {
    const target = await fixture(1);
    let releases = 0;
    await expect(preparePrimaryRuntimeBootstrap({
      ...target,
      opencodeRuntimeIdentity: {
        profileId: "managed",
        runtimeHome: join(target.root, "opencode-home"),
      },
      onReport: () => undefined,
      acquireOwnership: async () => ({
        dataRoot: target.dataRoot,
        release: async () => { releases += 1; },
      }),
      persistIdentity: async () => { throw new Error("fixture failure"); },
    })).rejects.toThrow("fixture failure");
    expect(releases).toBe(1);
  });
});
