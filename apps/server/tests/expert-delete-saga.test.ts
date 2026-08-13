import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "@onmyagent/types/server";
import { ApiError } from "../src/core/errors.js";
import {
  deleteExpertSessions,
  selectExpertDeleteOriginRecords,
} from "../src/services/expert-delete-saga.js";
import { upsertSessionOrigin, listSessionOrigins } from "../src/services/session-origins.js";
import { getExpertLifecycleEventsSnapshot, resetExpertLifecycleEventsForTest } from "../src/services/expert-lifecycle-events.js";

type Fixture = {
  root: string;
  workspace: WorkspaceInfo;
  config: ServerConfig;
  runtimeRoot: string;
  directory: string;
  journalPath: string;
};

async function fixture(sessionId = "session-1"): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "onmyagent-expert-delete-"));
  const workspacePath = join(root, "workspace");
  const runtimeRoot = join(root, "runtime");
  const directory = join(runtimeRoot, "workspace-hash", "agent", sessionId);
  await mkdir(workspacePath, { recursive: true });
  await mkdir(directory, { recursive: true });
  const workspace: WorkspaceInfo = {
    id: "delete-workspace",
    name: "Delete workspace",
    path: workspacePath,
    preset: "default",
    workspaceType: "local",
  };
  await writeFile(join(directory, "onmyagent-session.json"), JSON.stringify({
    kind: "expert-session",
    workspaceId: workspace.id,
    isolationVersion: 3,
    agentId: "agent-1",
    packageName: "package-1",
    sessionId,
    declaredSkills: [],
    installedSkills: [],
    missingSkills: [],
  }), "utf8");
  await upsertSessionOrigin(workspace, sessionId, {
    kind: "expert",
    agentId: "agent-1",
    packageName: "package-1",
    directory,
  });
  const journalPath = join(root, "server-data", "expert-delete-operations.json");
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    configPath: join(root, "server-data", "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: [],
    workspaces: [workspace],
    authorizedRoots: [workspacePath],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
  return { root, workspace, config, runtimeRoot, directory, journalPath };
}

async function runDelete(
  value: Fixture,
  input: Partial<Parameters<typeof deleteExpertSessions>[2]> = {},
  options: Parameters<typeof deleteExpertSessions>[3] = {},
) {
  return deleteExpertSessions(value.config, value.workspace, {
    operationId: "operation-1",
    agentId: "agent-1",
    packageName: "package-1",
    marketplace: "my-experts",
    expectedRevision: 1,
    ...input,
  }, {
    runtimeRoot: value.runtimeRoot,
    journalPath: value.journalPath,
    deleteSession: async () => undefined,
    removeRuntimeDirectory: async () => undefined,
    ...options,
  });
}

describe("Expert delete saga", () => {
  afterEach(() => resetExpertLifecycleEventsForTest());

  test("selectExpertDeleteOriginRecords recovers when packageName is agentId composite", () => {
    const items = [
      {
        sessionId: "ses_1",
        kind: "expert" as const,
        agentId: "kol-ops:kol-ops",
        packageName: "kol-ops",
        directory: "/tmp/a",
      },
    ];
    // Client bug: packageName fallback = full agentId
    const matched = selectExpertDeleteOriginRecords(items, {
      agentId: "kol-ops:kol-ops",
      packageName: "kol-ops:kol-ops",
    });
    expect(matched).toHaveLength(1);
    expect(matched[0]?.sessionId).toBe("ses_1");
    const byShortAgent = selectExpertDeleteOriginRecords(items, {
      agentId: "kol-ops",
      packageName: "kol-ops:kol-ops",
    });
    expect(byShortAgent.map((item) => item.sessionId)).toEqual(["ses_1"]);
  });

  test("package-name-only match does not select another expert", () => {
    const items = [
      {
        sessionId: "ses_other",
        kind: "expert" as const,
        agentId: "other-ops:other-ops",
        packageName: "kol-ops",
        directory: "/tmp/other",
      },
      {
        sessionId: "ses_self",
        kind: "expert" as const,
        agentId: "kol-ops:kol-ops",
        packageName: "kol-ops",
        directory: "/tmp/self",
      },
    ];
    const matched = selectExpertDeleteOriginRecords(items, {
      agentId: "missing:missing",
      packageName: "kol-ops",
    });
    expect(matched).toEqual([]);
    const compositePackage = selectExpertDeleteOriginRecords(items, {
      agentId: "other-ops:other-ops",
      packageName: "kol-ops:kol-ops",
    });
    expect(compositePackage.map((item) => item.sessionId)).toEqual(["ses_other"]);
  });

  test("requested ids only in a wider known set fail closed", async () => {
    const value = await fixture("session-1");
    try {
      const otherDirectory = join(value.runtimeRoot, "workspace-hash", "agent", "session-other");
      await mkdir(otherDirectory, { recursive: true });
      await upsertSessionOrigin(value.workspace, "session-other", {
        kind: "expert",
        agentId: "agent-1",
        packageName: "other-package",
        directory: otherDirectory,
        expectedRevision: 1,
      });
      await expect(runDelete(value, {
        operationId: "operation-wider-only",
        expectedRevision: 2,
        sessionIds: ["session-other"],
      })).rejects.toMatchObject({
        code: "expert_delete_target_not_found",
      } satisfies Partial<ApiError>);
      await expect(runDelete(value, {
        operationId: "operation-wider-mixed",
        expectedRevision: 2,
        sessionIds: ["session-1", "session-other"],
      })).rejects.toMatchObject({
        code: "expert_delete_target_not_found",
      } satisfies Partial<ApiError>);
      const origins = await listSessionOrigins(value.workspace);
      expect(origins.items.map((item) => item.sessionId).sort()).toEqual(["session-1", "session-other"]);
      expect(origins.tombstones).toHaveLength(0);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  test("no live origins and no journal is not an empty completed delete", async () => {
    const value = await fixture("session-1");
    try {
      await expect(runDelete(value, {
        operationId: "operation-wrong-agent",
        agentId: "missing-agent",
        packageName: "missing-pkg",
      })).rejects.toMatchObject({
        code: "expert_delete_target_not_found",
      } satisfies Partial<ApiError>);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  test("deletes when packageName is wrong composite but agentId matches", async () => {
    const value = await fixture("session-mismatch-pkg");
    try {
      const result = await runDelete(value, {
        operationId: "operation-mismatch-pkg",
        packageName: "agent-1:agent-1",
      });
      expect(result.state).toBe("completed");
      expect(result.steps).toHaveLength(1);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  test("refuses built-in marketplace before writing a journal", async () => {
    const value = await fixture();
    try {
      await expect(runDelete(value, { marketplace: "experts" })).rejects.toMatchObject({
        code: "expert_builtin_delete_forbidden",
      } satisfies Partial<ApiError>);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  test("fails closed for a corrupt or malformed journal", async () => {
    const value = await fixture();
    try {
      await mkdir(join(value.root, "server-data"), { recursive: true });
      await writeFile(value.journalPath, JSON.stringify([{
        version: 1,
        operationId: "operation-1",
        workspaceId: value.workspace.id,
        // agentId/packageName/revision/state/step fields are intentionally absent.
        steps: [],
      }]), "utf8");
      await expect(runDelete(value)).rejects.toMatchObject({
        code: "expert_delete_journal_corrupt",
      } satisfies Partial<ApiError>);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  test("rejects a journal path inside the workspace", async () => {
    const value = await fixture();
    try {
      await expect(runDelete(value, {}, {
        journalPath: join(value.workspace.path, "expert-delete-operations.json"),
      })).rejects.toMatchObject({
        code: "expert_delete_journal_unsafe",
      } satisfies Partial<ApiError>);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  test("deletes OpenCode/runtime before tombstone and replays without revision drift", async () => {
    const value = await fixture();
    let openCodeCalls = 0;
    let runtimeCalls = 0;
    try {
      const result = await runDelete(value, {}, {
        deleteSession: async () => { openCodeCalls += 1; },
        removeRuntimeDirectory: async () => { runtimeCalls += 1; },
      });
      expect(result.state).toBe("completed");
      expect(result.revision).toBe(2);
      expect(result.steps[0]).toMatchObject({ openCode: "completed", runtime: "completed", tombstone: "completed" });
      expect(openCodeCalls).toBe(1);
      expect(runtimeCalls).toBe(1);
      const firstEvents = getExpertLifecycleEventsSnapshot().events.filter((event) => event.kind === "delete");
      expect(firstEvents.map((event) => event.step)).toEqual([undefined, "opencode", "runtime", "tombstone", "complete"]);
      expect(firstEvents[1]?.sessionHash).toMatch(/^sha256:[a-f0-9]{16}$/);
      expect(JSON.stringify(firstEvents)).not.toContain(value.directory);
      const replay = await runDelete(value, {}, {
        deleteSession: async () => { openCodeCalls += 1; },
        removeRuntimeDirectory: async () => { runtimeCalls += 1; },
      });
      expect(replay).toEqual(result);
      expect(openCodeCalls).toBe(1);
      expect(runtimeCalls).toBe(1);
      expect(getExpertLifecycleEventsSnapshot().events.filter((event) => event.kind === "delete")).toHaveLength(6);
      expect((await listSessionOrigins(value.workspace)).revision).toBe(2);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  test("treats an OpenCode 404 as idempotent missing", async () => {
    const value = await fixture();
    try {
      const result = await runDelete(value, {}, {
        deleteSession: async () => { throw new ApiError(502, "opencode_request_failed", "missing", { status: 404 }); },
      });
      expect(result.steps[0]).toMatchObject({ openCode: "skipped", code: "session_missing", tombstone: "completed" });
      expect(result.state).toBe("completed");
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  test("does not tombstone an unauthorized runtime directory", async () => {
    const value = await fixture();
    const outside = join(value.root, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "onmyagent-session.json"), "{}", "utf8");
    await upsertSessionOrigin(value.workspace, "session-1", {
      kind: "expert", agentId: "agent-1", packageName: "package-1", directory: outside,
      expectedRevision: 1,
    });
    try {
      const result = await runDelete(value, { expectedRevision: 2 });
      expect(result.state).toBe("partial");
      expect(result.steps[0]).toMatchObject({ runtime: "failed", code: "runtime_path_unauthorized", tombstone: "pending" });
      expect((await listSessionOrigins(value.workspace)).items).toHaveLength(1);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  test("replays a crash before and after tombstone without duplicate revision", async () => {
    const value = await fixture();
    try {
      let before = true;
      await expect(runDelete(value, {}, { beforeTombstone: async () => {
        if (before) { before = false; throw new Error("crash-before-tombstone"); }
      } })).rejects.toThrow("crash-before-tombstone");
      const recovered = await runDelete(value);
      expect(recovered.state).toBe("completed");
      expect(recovered.revision).toBe(2);

      const second = await fixture("session-2");
      let after = true;
      await expect(runDelete(second, {}, { afterTombstone: async () => {
        if (after) { after = false; throw new Error("crash-after-tombstone"); }
      } })).rejects.toThrow("crash-after-tombstone");
      const replay = await runDelete(second);
      expect(replay.state).toBe("completed");
      expect(replay.revision).toBe(2);
      expect((await listSessionOrigins(second.workspace)).revision).toBe(2);
      await rm(second.root, { recursive: true, force: true });
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  test("retries transient OpenCode and runtime failures before writing the tombstone", async () => {
    const value = await fixture();
    let openCodeCalls = 0;
    let runtimeCalls = 0;
    try {
      const options = {
        deleteSession: async () => {
          openCodeCalls += 1;
          if (openCodeCalls === 1) throw new Error("transient OpenCode failure");
        },
        removeRuntimeDirectory: async () => {
          runtimeCalls += 1;
          if (runtimeCalls === 1) throw new Error("transient runtime failure");
        },
      };
      const first = await runDelete(value, {}, options);
      expect(first.state).toBe("partial");
      expect(first.steps[0]).toMatchObject({
        openCode: "failed",
        runtime: "pending",
        tombstone: "pending",
      });
      expect((await listSessionOrigins(value.workspace)).items).toHaveLength(1);

      const second = await runDelete(value, {}, options);
      expect(second.state).toBe("partial");
      expect(second.steps[0]).toMatchObject({
        openCode: "completed",
        runtime: "failed",
        tombstone: "pending",
      });
      expect((await listSessionOrigins(value.workspace)).items).toHaveLength(1);

      const third = await runDelete(value, {}, options);
      expect(third.state).toBe("completed");
      expect(third.steps[0]).toMatchObject({
        openCode: "completed",
        runtime: "completed",
        tombstone: "completed",
      });
      expect(openCodeCalls).toBe(2);
      expect(runtimeCalls).toBe(2);
      const origins = await listSessionOrigins(value.workspace);
      expect(origins.items).toHaveLength(0);
      expect(origins.tombstones).toHaveLength(1);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });

  test("rejects a completed operation replay with a different package", async () => {
    const value = await fixture();
    try {
      await runDelete(value);
      await expect(runDelete(value, { packageName: "another-package" })).rejects.toMatchObject({
        code: "expert_delete_operation_conflict",
      } satisfies Partial<ApiError>);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });
});
