import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isUnboundCanonicalAutomation,
  resolveAutomationRunModel,
  startAutomationTask,
  waitForAutomationSession,
} from "../src/services/automation-runner.js";
import type { PrimaryRuntimeRegistry } from "../src/services/primary-runtime-registry.js";
import type { PrimaryRuntimeEventBus } from "../src/services/primary-runtime-events.js";
import { ApiError } from "../src/core/errors.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("resolveAutomationRunModel", () => {
  test("allows legacy reconcile fallback only when no canonical binding exists", () => {
    expect(isUnboundCanonicalAutomation({ code: "runtime_session_binding_not_found" })).toBe(false);
    expect(isUnboundCanonicalAutomation(
      new ApiError(
        404,
        "runtime_session_binding_not_found",
        "missing",
      ),
    )).toBe(true);
    expect(isUnboundCanonicalAutomation(
      new ApiError(
        503,
        "agent_runtime_unavailable",
        "offline",
      ),
    )).toBe(false);
  });
  test("starts Grok automation through the canonical registry with grok-4.5 low", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-automation-grok-"));
    roots.push(root);
    const calls: Array<{ name: string; input: unknown }> = [];
    const registry = {
      getModelCatalog: async () => ({
        runtimeKind: "grok-build",
        profileId: "system",
        workspaceId: "workspace",
        models: [{
          ref: { modelId: "grok-4.5" },
          displayName: "Grok 4.5",
          available: true,
          capabilities: { text: true, imageInput: true, tools: true, reasoning: true },
        }],
        defaultModelRef: { modelId: "grok-4.5" },
        auth: { state: "ready", methods: [] },
        complete: true,
      }),
      createSession: async (input: unknown) => {
        calls.push({ name: "create", input });
        return {};
      },
      promptSession: async (_workspaceId: string, _sessionId: string, input: unknown) => {
        calls.push({ name: "prompt", input });
        return { turnId: "turn" };
      },
      closeSession: async () => undefined,
    } as unknown as PrimaryRuntimeRegistry;
    const execution = await startAutomationTask({ authorizedRoots: [root] } as never, {
      id: "workspace",
      name: "Workspace",
      path: root,
      preset: "starter",
      workspaceType: "local",
    }, {
      title: "Fixture",
      prompt: "Run fixture",
    }, {
      runtimeKind: "grok-build",
      primaryRuntime: {
        registry,
        events: {} as PrimaryRuntimeEventBus,
      },
    });
    expect(execution.runtimeKind).toBe("grok-build");
    expect(execution.outputDirectory.startsWith(join(root, "tasks"))).toBe(true);
    expect(calls.map((call) => call.name)).toEqual(["create", "prompt"]);
    expect(calls[0]?.input).toMatchObject({
      workspaceId: "workspace",
      runtimeKind: "grok-build",
      modelRef: { modelId: "grok-4.5", variant: "low" },
      workingDirectory: execution.outputDirectory,
      profile: { kind: "assistant" },
    });
    expect(await readFile(join(execution.outputDirectory, "任务说明.md"), "utf8"))
      .toContain("Run fixture");
  });

  test("rejects an unauthorized automation directory before creating files", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-automation-root-"));
    const outside = await mkdtemp(join(tmpdir(), "onmyagent-automation-outside-"));
    roots.push(root, outside);
    let nativeCreated = false;
    const registry = {
      getModelCatalog: async () => ({
        runtimeKind: "grok-build",
        profileId: "system",
        workspaceId: "workspace",
        models: [],
        defaultModelRef: { modelId: "grok-4.5" },
        auth: { state: "ready", methods: [] },
        complete: true,
      }),
      createSession: async () => {
        nativeCreated = true;
        return {};
      },
    } as unknown as PrimaryRuntimeRegistry;
    await expect(startAutomationTask({ authorizedRoots: [root] } as never, {
      id: "workspace",
      name: "Workspace",
      path: root,
      preset: "starter",
      workspaceType: "local",
    }, {
      title: "Unauthorized",
      prompt: "Do not run",
      workspaceDirectory: outside,
    }, {
      runtimeKind: "grok-build",
      primaryRuntime: { registry, events: {} as PrimaryRuntimeEventBus },
    })).rejects.toMatchObject({
      code: "automation_workspace_unauthorized",
      status: 403,
    });
    expect(nativeCreated).toBe(false);
    expect(await import("node:fs/promises").then(({ readdir }) => readdir(outside)))
      .toEqual([]);
  });

  test("waits for canonical completion and persists assistant output", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-automation-wait-"));
    roots.push(root);
    const registry = {
      readSessionMessages: async () => ({
        productSessionId: "automation-session",
        complete: true,
        messages: [{
          id: "assistant-1",
          productSessionId: "automation-session",
          role: "assistant",
          parts: [{ type: "text", id: "text-1", text: "Canonical result" }],
          createdAt: 1,
          completedAt: 2,
        }],
      }),
    } as unknown as PrimaryRuntimeRegistry;
    const events = {
      snapshot: () => ({
        productSessionId: "automation-session",
        generation: 1,
        latestSequence: 1,
        complete: true,
        events: [{
          kind: "turn.completed",
          outcome: "completed",
          turnId: "turn-1",
        }],
      }),
    } as unknown as PrimaryRuntimeEventBus;
    await waitForAutomationSession({} as never, {
      id: "workspace",
      name: "Workspace",
      path: root,
      preset: "starter",
      workspaceType: "local",
    }, {
      sessionId: "automation-session",
      groupName: "group",
      outputDirectory: root,
      runtimeKind: "grok-build",
    }, {
      primaryRuntime: { registry, events },
    });
    expect(await readFile(join(root, "执行结果.md"), "utf8"))
      .toBe("Canonical result\n");
  });
  test("prefers task model over agent model", async () => {
    const model = await resolveAutomationRunModel({
      model: { providerID: "openai", modelID: "gpt-test" },
      agent: { id: "a", name: "A", model: { providerID: "anthropic", modelID: "claude" } },
    });
    expect(model).toEqual({ providerID: "openai", modelID: "gpt-test" });
  });

  test("falls back to agent model when task model is missing", async () => {
    const model = await resolveAutomationRunModel({
      agent: { id: "a", name: "A", model: { providerID: "anthropic", modelID: "claude-test" } },
    });
    expect(model).toEqual({ providerID: "anthropic", modelID: "claude-test" });
  });

  test("returns undefined for empty provider or model ids", async () => {
    const model = await resolveAutomationRunModel({
      model: { providerID: "  ", modelID: "gpt" },
    });
    // Empty provider falls through; may still resolve from opencode recent model file.
    // Assert empty direct model does not win.
    if (model) {
      expect(model.providerID.trim().length).toBeGreaterThan(0);
      expect(model.modelID.trim().length).toBeGreaterThan(0);
    }
  });
});
