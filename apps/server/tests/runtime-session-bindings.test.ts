import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { RuntimeSessionBinding } from "@onmyagent/types/agent-runtime";
import type { WorkspaceInfo } from "@onmyagent/types/server";
import {
  RuntimeSessionBindingStore,
  resolveRuntimeSessionBindingStorePath,
  type VerifiedOpenCodeSessionInventoryItem,
} from "../src/services/runtime-session-bindings.js";

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) await rm(root, { recursive: true, force: true });
  }
});

async function fixture(id = "workspace-a") {
  const root = await mkdtemp(join(tmpdir(), "onmyagent-runtime-bindings-"));
  roots.push(root);
  const workspace: WorkspaceInfo = {
    id,
    name: id,
    path: join(root, "repo"),
    preset: "starter",
    workspaceType: "local",
  };
  const path = resolveRuntimeSessionBindingStorePath({ workspace, dataRoot: root });
  return {
    root,
    workspace,
    path,
    store: new RuntimeSessionBindingStore({ workspace, dataRoot: root }),
  };
}

function binding(
  workspaceId: string,
  productSessionId: string,
  overrides: Partial<RuntimeSessionBinding> = {},
): RuntimeSessionBinding {
  return {
    productSessionId,
    runtimeKind: "opencode",
    runtimeSessionId: `native-${productSessionId}`,
    workspaceId,
    cwd: "/Users/fixture/repo",
    profileId: "local",
    runtimeHome: "/Users/fixture/.local/share/opencode",
    createdAt: 1_800_000_000_000,
    source: "explicit",
    ...overrides,
  };
}

function inventory(
  productSessionId: string,
  overrides: Partial<VerifiedOpenCodeSessionInventoryItem> = {},
): VerifiedOpenCodeSessionInventoryItem {
  return {
    productSessionId,
    runtimeSessionId: `native-${productSessionId}`,
    cwd: "/Users/fixture/repo",
    profileId: "local",
    runtimeHome: "/Users/fixture/.local/share/opencode",
    createdAt: 1_700_000_000_000,
    ...overrides,
  };
}

describe("RuntimeSessionBindingStore", () => {
  test("uses an external runtime-state root and a hashed workspace directory", async () => {
    const target = await fixture("workspace/with:unsafe\\id");
    expect(target.path).toStartWith(join(target.root, "runtime-state", "primary-runtime"));
    expect(target.path).not.toContain(target.workspace.id);
    expect(target.path).not.toStartWith(target.workspace.path);
  });

  test("returns structured missing state, then atomically upserts, gets, lists and deletes", async () => {
    const target = await fixture();
    await expect(target.store.list()).resolves.toMatchObject({
      state: "missing",
      complete: false,
      revision: 0,
      bindings: [],
    });

    const first = binding(target.workspace.id, "session-a");
    await expect(target.store.upsert(first)).resolves.toEqual(first);
    await expect(target.store.get(first.productSessionId)).resolves.toEqual(first);
    await expect(target.store.list()).resolves.toMatchObject({
      state: "ok",
      complete: true,
      revision: 1,
      bindings: [first],
    });
    const persisted = JSON.parse(await readFile(target.path, "utf8"));
    expect(persisted).toEqual({ version: 1, revision: 1, bindings: [first] });
    expect(await target.store.delete(first.productSessionId)).toBe(true);
    expect(await target.store.delete(first.productSessionId)).toBe(false);
    await expect(target.store.list()).resolves.toMatchObject({ revision: 2, bindings: [] });
  });

  test("persists a strict runtime profile for sticky restart without secrets outside the binding store", async () => {
    const target = await fixture();
    const profiled = binding(target.workspace.id, "session-profiled", {
      runtimeKind: "grok-build",
      profile: {
        kind: "expert",
        expertId: "expert-a",
        name: "Expert A",
        description: "Fixture expert",
        systemPrompt: "Private Expert instructions",
        declaredSkillNames: ["documents"],
        activatedSkillNames: ["documents"],
      },
    });
    await target.store.upsert(profiled);
    expect((await target.store.get(profiled.productSessionId))?.profile).toEqual({
      ...profiled.profile,
      approvedAgentIds: [],
    });
    await expect(target.store.upsert({
      ...profiled,
      profile: { ...profiled.profile!, secret: "must-not-persist" },
    } as RuntimeSessionBinding)).rejects.toThrow();
  });

  test("serializes concurrent writes without lost updates", async () => {
    const target = await fixture();
    const items = Array.from({ length: 20 }, (_, index) =>
      binding(target.workspace.id, `session-${index}`)
    );
    await Promise.all(items.map((item) => target.store.upsert(item)));
    const listed = await target.store.list();
    expect(listed.complete).toBe(true);
    expect(listed.revision).toBe(items.length);
    expect(listed.bindings).toHaveLength(items.length);
    expect(new Set(listed.bindings.map((item) => item.productSessionId)).size).toBe(items.length);
  });

  test("fails closed for corrupt, truncated, unknown-version and strict-envelope fixtures", async () => {
    const fixtures: Array<{ contents: string; state: string; sourceVersion?: number }> = [
      { contents: "not json", state: "corrupt" },
      { contents: '{"version":1,"bindings":', state: "corrupt" },
      { contents: JSON.stringify({ version: 99, revision: 3, bindings: [] }), state: "unknown_version", sourceVersion: 99 },
      { contents: JSON.stringify({ version: 1, revision: 3, bindings: [], future: true }), state: "corrupt" },
    ];
    for (const [index, item] of fixtures.entries()) {
      const target = await fixture(`workspace-corrupt-${index}`);
      await mkdir(dirname(target.path), { recursive: true });
      await writeFile(target.path, item.contents, "utf8");
      await expect(target.store.list()).resolves.toMatchObject({
        complete: false,
        state: item.state,
        bindings: [],
        ...(item.sourceVersion !== undefined ? { sourceVersion: item.sourceVersion } : {}),
      });
      await expect(target.store.upsert(binding(target.workspace.id, "must-not-write")))
        .rejects.toMatchObject({ code: "runtime_session_bindings_unavailable" });
      await expect(target.store.get("must-not-read"))
        .rejects.toMatchObject({ code: "runtime_session_bindings_unavailable" });
      await expect(target.store.delete("must-not-write"))
        .rejects.toMatchObject({ code: "runtime_session_bindings_unavailable" });
      expect(await readFile(target.path, "utf8")).toBe(item.contents);
    }
  });

  test("treats foreign workspace and duplicate identities as corruption", async () => {
    for (const [name, bindings] of [
      ["foreign", [binding("workspace-foreign", "session-a")]],
      ["product-duplicate", [
        binding("workspace-a", "session-a"),
        binding("workspace-a", "session-a", { runtimeSessionId: "other-native" }),
      ]],
      ["native-duplicate", [
        binding("workspace-a", "session-a", { runtimeSessionId: "shared-native" }),
        binding("workspace-a", "session-b", { runtimeSessionId: "shared-native" }),
      ]],
    ] as const) {
      const target = await fixture("workspace-a");
      await mkdir(dirname(target.path), { recursive: true });
      await writeFile(
        target.path,
        `${JSON.stringify({ version: 1, revision: 1, bindings })}\n`,
        "utf8",
      );
      await expect(target.store.list()).resolves.toMatchObject({
        complete: false,
        state: "corrupt",
        bindings: [],
      });
      await expect(target.store.upsert(binding(target.workspace.id, `${name}-new`)))
        .rejects.toMatchObject({ code: "runtime_session_bindings_unavailable" });
    }
  });

  test("rejects explicit cross-workspace and native identity conflicts", async () => {
    const target = await fixture();
    await expect(target.store.upsert(binding("workspace-b", "session-a")))
      .rejects.toMatchObject({ code: "runtime_session_binding_workspace_mismatch" });
    await target.store.upsert(binding(target.workspace.id, "session-a", {
      runtimeSessionId: "native-shared",
    }));
    await expect(target.store.upsert(binding(target.workspace.id, "session-b", {
      runtimeSessionId: "native-shared",
    }))).rejects.toMatchObject({ code: "runtime_session_binding_native_id_conflict" });

    await expect(target.store.upsert(binding(target.workspace.id, "session-c", {
      runtimeSessionId: "native-shared",
      runtimeHome: "/Users/fixture/.isolated-opencode",
    }))).resolves.toMatchObject({ productSessionId: "session-c" });
  });

  test("keeps product bindings sticky and treats an identical upsert as idempotent", async () => {
    const target = await fixture();
    const first = binding(target.workspace.id, "sticky-session");
    await target.store.upsert(first);
    await expect(target.store.upsert(first)).resolves.toEqual(first);
    await expect(target.store.list()).resolves.toMatchObject({ revision: 1 });
    await expect(target.store.upsert({
      ...first,
      runtimeKind: "grok-build",
      runtimeSessionId: "grok-native",
      runtimeHome: "/Users/fixture/.grok",
    })).rejects.toMatchObject({ code: "runtime_session_binding_immutable" });
    await expect(target.store.list()).resolves.toMatchObject({ revision: 1, bindings: [first] });
  });

  test("updates and clears only the mutable model reference", async () => {
    const target = await fixture();
    const first = binding(target.workspace.id, "model-session");
    await target.store.upsert(first);
    await expect(target.store.updateModelRef(first.productSessionId, {
      providerId: "openai",
      modelId: "gpt-5",
    })).resolves.toEqual({
      ...first,
      modelRef: { providerId: "openai", modelId: "gpt-5" },
    });
    await expect(target.store.updateModelRef(first.productSessionId, undefined))
      .resolves.toEqual(first);
    await expect(target.store.list()).resolves.toMatchObject({
      revision: 3,
      bindings: [first],
    });
  });

  test("updates and clears only the sticky runtime mode", async () => {
    const target = await fixture();
    const first = binding(target.workspace.id, "mode-session");
    await target.store.upsert(first);
    await expect(target.store.updateMode(first.productSessionId, "plan"))
      .resolves.toEqual({ ...first, mode: "plan" });
    await expect(target.store.updateMode(first.productSessionId, undefined))
      .resolves.toEqual(first);
  });

  test("rejects stale mutation revisions", async () => {
    const target = await fixture();
    await target.store.upsert(binding(target.workspace.id, "session-a"), {
      expectedRevision: 0,
    });
    await expect(target.store.upsert(binding(target.workspace.id, "session-b"), {
      expectedRevision: 0,
    })).rejects.toMatchObject({ code: "runtime_session_bindings_revision_conflict" });
    await expect(target.store.delete("session-a", { expectedRevision: 0 }))
      .rejects.toMatchObject({ code: "runtime_session_bindings_revision_conflict" });
    await expect(target.store.backfillVerifiedOpenCodeInventory(
      [inventory("legacy-session")],
      { expectedRevision: 0 },
    )).rejects.toMatchObject({ code: "runtime_session_bindings_revision_conflict" });
    await expect(target.store.delete("session-a", { expectedRevision: 1 })).resolves.toBe(true);
  });

  test("rejects an explicitly injected runtime root inside the workspace", async () => {
    const target = await fixture();
    expect(() => new RuntimeSessionBindingStore({
      workspace: target.workspace,
      dataRoot: join(target.workspace.path, ".onmyagent-state"),
    })).toThrow(expect.objectContaining({
      code: "runtime_session_binding_store_inside_workspace",
    }));
  });

  test("rejects a symlinked runtime root that resolves inside the workspace", async () => {
    const target = await fixture();
    const actualRoot = join(target.workspace.path, ".onmyagent-state");
    const linkedRoot = join(target.root, "linked-runtime-state");
    await mkdir(actualRoot, { recursive: true });
    await symlink(actualRoot, linkedRoot, process.platform === "win32" ? "junction" : "dir");
    expect(() => new RuntimeSessionBindingStore({
      workspace: target.workspace,
      dataRoot: linkedRoot,
    })).toThrow(expect.objectContaining({
      code: "runtime_session_binding_store_inside_workspace",
    }));
  });

  test("round-trips Windows paths without path inference or normalization", async () => {
    const target = await fixture();
    const windows = binding(target.workspace.id, "windows-session", {
      cwd: "C:\\Users\\agent\\workspace",
      runtimeHome: "C:\\Users\\agent\\AppData\\Local\\opencode",
    });
    await target.store.upsert(windows);
    await expect(target.store.get(windows.productSessionId)).resolves.toEqual(windows);
  });

  test("writes with private permissions on POSIX", async () => {
    if (process.platform === "win32") return;
    const target = await fixture();
    await target.store.upsert(binding(target.workspace.id, "session-a"));
    expect((await stat(target.path)).mode & 0o777).toBe(0o600);
  });

  test("backfills only verified unambiguous OpenCode inventory and preserves native data", async () => {
    const target = await fixture();
    const result = await target.store.backfillVerifiedOpenCodeInventory([
      inventory("session-a"),
      inventory("session-b", {
        cwd: "C:\\Users\\agent\\repo",
        runtimeHome: "C:\\Users\\agent\\AppData\\Local\\opencode",
      }),
    ]);
    expect(result).toMatchObject({ added: 2, complete: true, failures: [] });
    expect(result.bindings.every((item) =>
      item.runtimeKind === "opencode" && item.source === "legacy-opencode-backfill"
    )).toBe(true);
    const listed = await target.store.list();
    expect(listed.bindings).toHaveLength(2);
  });

  test("reports duplicate and invalid backfill inventory as incomplete without guessing", async () => {
    const target = await fixture();
    const result = await target.store.backfillVerifiedOpenCodeInventory([
      inventory("product-duplicate", { runtimeSessionId: "native-a" }),
      inventory("product-duplicate", { runtimeSessionId: "native-b" }),
      inventory("native-duplicate-a", { runtimeSessionId: "native-shared" }),
      inventory("native-duplicate-b", { runtimeSessionId: "native-shared" }),
      inventory("invalid", { cwd: "" }),
      inventory("safe"),
    ]);
    expect(result.complete).toBe(false);
    expect(result.added).toBe(1);
    expect(result.bindings.map((item) => item.productSessionId)).toEqual(["safe"]);
    expect(result.failures).toEqual(expect.arrayContaining([
      { index: 0, code: "duplicate_product_session_id" },
      { index: 1, code: "duplicate_product_session_id" },
      { index: 2, code: "duplicate_runtime_session_id" },
      { index: 3, code: "duplicate_runtime_session_id" },
      { index: 4, code: "invalid_inventory_item" },
    ]));
    expect((await target.store.list()).bindings.map((item) => item.productSessionId)).toEqual(["safe"]);
  });

  test("backfill is idempotent and conflicts with existing non-OpenCode binding fail closed", async () => {
    const target = await fixture();
    const verified = inventory("legacy-session");
    await expect(target.store.backfillVerifiedOpenCodeInventory([verified]))
      .resolves.toMatchObject({ added: 1, complete: true });
    await expect(target.store.backfillVerifiedOpenCodeInventory([verified]))
      .resolves.toMatchObject({ added: 0, complete: true, failures: [] });

    await target.store.upsert(binding(target.workspace.id, "grok-session", {
      runtimeKind: "grok-build",
      runtimeSessionId: "grok-native",
      runtimeHome: "/Users/fixture/.grok",
    }));
    const conflict = await target.store.backfillVerifiedOpenCodeInventory([
      inventory("grok-session", { runtimeSessionId: "different-opencode-native" }),
    ]);
    expect(conflict).toMatchObject({ added: 0, complete: false });
    expect(conflict.failures).toEqual([
      { index: 0, code: "conflicting_existing_binding" },
    ]);
  });
});
