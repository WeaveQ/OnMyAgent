import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  AgentRuntimeSelectionStore,
  resolveAgentRuntimeSelectionPath,
} from "../src/services/agent-runtime-selection.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "onmyagent-runtime-selection-"));
  roots.push(root);
  return {
    root,
    path: resolveAgentRuntimeSelectionPath(root),
    store: new AgentRuntimeSelectionStore({ dataRoot: root }),
  };
}

describe("AgentRuntimeSelectionStore", () => {
  test("defaults missing state to OpenCode without persisting a file", async () => {
    const target = await fixture();
    await expect(target.store.read()).resolves.toEqual({
      state: "missing",
      complete: true,
      config: {
        version: 1,
        revision: 0,
        defaultRuntimeKind: "opencode",
        workspaceOverrides: {},
      },
    });
    await expect(target.store.resolve("workspace-a")).resolves.toEqual({
      runtimeKind: "opencode",
      source: "global-default",
      revision: 0,
    });
    await expect(stat(target.path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("persists global, workspace, and Grok profile selections atomically", async () => {
    const target = await fixture();
    await expect(target.store.setDefaultRuntimeKind("grok-build", {
      expectedRevision: 0,
    })).resolves.toMatchObject({ revision: 1, defaultRuntimeKind: "grok-build" });
    await expect(target.store.setWorkspaceOverride("workspace-a", "opencode", {
      expectedRevision: 1,
    })).resolves.toMatchObject({
      revision: 2,
      workspaceOverrides: { "workspace-a": "opencode" },
    });
    await expect(target.store.setGrokBuildSelection({
      profileId: "system",
      homeMode: "system",
      binaryMode: "system",
    }, { expectedRevision: 2 })).resolves.toMatchObject({ revision: 3 });

    await expect(target.store.resolve("workspace-a")).resolves.toEqual({
      runtimeKind: "opencode",
      source: "workspace-override",
      revision: 3,
    });
    await expect(target.store.resolve("workspace-b")).resolves.toEqual({
      runtimeKind: "grok-build",
      source: "global-default",
      revision: 3,
    });
    expect(JSON.parse(await readFile(target.path, "utf8"))).toEqual({
      version: 1,
      revision: 3,
      defaultRuntimeKind: "grok-build",
      workspaceOverrides: { "workspace-a": "opencode" },
      grokBuild: {
        profileId: "system",
        homeMode: "system",
        binaryMode: "system",
      },
    });
  });

  test("serializes concurrent workspace updates without losing selections", async () => {
    const target = await fixture();
    await Promise.all(Array.from({ length: 20 }, (_, index) =>
      target.store.setWorkspaceOverride(`workspace-${index}`, "grok-build")
    ));
    const result = await target.store.read();
    expect(result.config?.revision).toBe(20);
    expect(Object.keys(result.config?.workspaceOverrides ?? {})).toHaveLength(20);
  });

  test("keeps idempotent updates revision-stable and clears optional values", async () => {
    const target = await fixture();
    await target.store.setDefaultRuntimeKind("opencode");
    expect((await target.store.read()).config?.revision).toBe(0);
    await target.store.setWorkspaceOverride("workspace-a", "grok-build");
    await target.store.setWorkspaceOverride("workspace-a", "grok-build");
    expect((await target.store.read()).config?.revision).toBe(1);
    await target.store.setWorkspaceOverride("workspace-a", null);
    await target.store.setGrokBuildSelection({ profileId: "system" });
    await target.store.setGrokBuildSelection(null);
    await expect(target.store.read()).resolves.toMatchObject({
      config: { revision: 4, workspaceOverrides: {} },
    });
  });

  test("fails closed for corrupt, truncated, unknown-version, and secret fields", async () => {
    const fixtures = [
      { contents: "not-json", state: "corrupt" },
      { contents: '{"version":1,"revision":', state: "corrupt" },
      {
        contents: JSON.stringify({
          version: 2,
          revision: 1,
          defaultRuntimeKind: "opencode",
          workspaceOverrides: {},
        }),
        state: "unknown_version",
        sourceVersion: 2,
      },
      {
        contents: JSON.stringify({
          version: 1,
          revision: 1,
          defaultRuntimeKind: "opencode",
          workspaceOverrides: {},
          authToken: "must-not-persist",
        }),
        state: "corrupt",
      },
      {
        contents: JSON.stringify({
          version: 1,
          revision: 1,
          defaultRuntimeKind: "opencode",
          workspaceOverrides: {},
          opencode: {
            profileId: "managed",
            runtimeHome: "/fixture/opencode-data",
            apiKey: "must-not-persist",
          },
        }),
        state: "corrupt",
      },
    ];
    for (const item of fixtures) {
      const target = await fixture();
      await mkdir(dirname(target.path), { recursive: true });
      await writeFile(target.path, item.contents, "utf8");
      await expect(target.store.read()).resolves.toMatchObject({
        state: item.state,
        complete: false,
        config: null,
        ...(item.sourceVersion ? { sourceVersion: item.sourceVersion } : {}),
      });
      await expect(target.store.resolve("workspace-a"))
        .rejects.toMatchObject({ code: "agent_runtime_selection_unavailable" });
      await expect(target.store.setDefaultRuntimeKind("grok-build"))
        .rejects.toMatchObject({ code: "agent_runtime_selection_unavailable" });
      expect(await readFile(target.path, "utf8")).toBe(item.contents);
    }
  });

  test("rejects stale or invalid revisions and invalid runtime values", async () => {
    const target = await fixture();
    await target.store.setDefaultRuntimeKind("grok-build", { expectedRevision: 0 });
    await expect(target.store.setWorkspaceOverride("workspace-a", "opencode", {
      expectedRevision: 0,
    })).rejects.toMatchObject({ code: "agent_runtime_selection_revision_conflict" });
    await expect(target.store.setDefaultRuntimeKind("opencode", {
      expectedRevision: -1,
    })).rejects.toMatchObject({ code: "agent_runtime_selection_revision_invalid" });
    await expect(target.store.setDefaultRuntimeKind("personal" as "opencode"))
      .rejects.toBeDefined();
    await expect(target.store.setWorkspaceOverride("", "opencode"))
      .rejects.toMatchObject({ code: "invalid_payload" });
  });

  test("writes private files on POSIX and stores no raw binary path", async () => {
    const target = await fixture();
    await target.store.setGrokBuildSelection({
      profileId: "system",
      homeMode: "system",
      binaryMode: "system",
    });
    const contents = await readFile(target.path, "utf8");
    expect(contents).not.toContain("binaryPath");
    if (process.platform !== "win32") {
      expect((await stat(target.path)).mode & 0o777).toBe(0o600);
    }
  });
});
