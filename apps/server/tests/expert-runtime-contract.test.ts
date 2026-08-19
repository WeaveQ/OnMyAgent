import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WorkspaceInfo } from "@onmyagent/types/server";

import {
  assertExpertPromptTokenBudget,
  assertExpertRuntimeContract,
  ensureAndAssertExpertRuntimeContract,
  estimateExpertPromptTokens,
  ExpertRuntimeContractError,
  EXPERT_PROMPT_TOKEN_LIMIT,
  resolveDeclaredExpertAgentIds,
  resolveExpertPromptAgent,
} from "../src/services/expert-runtime-contract.js";
import { createExpertSessionRuntimeDirectory } from "../src/services/expert-session-runtime.js";
import { getExpertLifecycleEventsSnapshot, resetExpertLifecycleEventsForTest } from "../src/services/expert-lifecycle-events.js";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "onmyagent-runtime-contract-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  resetExpertLifecycleEventsForTest();
});

describe("Expert runtime contract", () => {
  test("allows onmyagent and package-declared agents, but fails closed for unknown/heavy ids", () => {
    expect(resolveExpertPromptAgent(undefined)).toBe("onmyagent");
    expect(resolveExpertPromptAgent("package-agent", ["package-agent"])).toBe("package-agent");
    expect(() => resolveExpertPromptAgent("package-agent", ["pkg:package-agent"])).toThrow();
    expect(() => resolveExpertPromptAgent("sisyphus")).toThrow();
    expect(() => resolveExpertPromptAgent("unlisted", ["package-agent"])).toThrow();
    const derived = resolveDeclaredExpertAgentIds({
      approvedAgentIds: [],
      markerAgent: "kol-content-ops-specialist",
      packageName: "kol-content-ops-specialist",
      agentId: "kol-content-ops-specialist:kol-content-ops-specialist",
    });
    expect(derived).toContain("kol-content-ops-specialist");
    expect(resolveExpertPromptAgent("kol-content-ops-specialist", derived)).toBe(
      "kol-content-ops-specialist",
    );
    expect(() => resolveExpertPromptAgent("sisyphus", derived)).toThrow();
  });

  test("accepts the package lead agent when approvedAgentIds is empty", async () => {
    const workspace = testWorkspace(join(root, "workspace-lead"));
    await mkdir(workspace.path, { recursive: true });
    const runtimeRoot = join(root, "runtime-lead");
    const created = await createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot,
      agentName: "kol-content-ops-specialist",
      agentId: "kol-content-ops-specialist:kol-content-ops-specialist",
      packageName: "kol-content-ops-specialist",
      sessionId: "session-lead",
    });
    const snapshot = await assertExpertRuntimeContract({
      workspace,
      sessionId: "session-lead",
      directory: created.directory,
      agent: "kol-content-ops-specialist",
      runtimeRoot,
      promptBody: { agent: "kol-content-ops-specialist", parts: [{ type: "text", text: "hi" }] },
    });
    expect(snapshot.agent).toBe("kol-content-ops-specialist");
  });

  test("asserts marker v3, identity, default agent, plugin isolation, and skills", async () => {
    const workspace = testWorkspace(join(root, "workspace"));
    await mkdir(workspace.path, { recursive: true });
    const runtimeRoot = join(root, "runtime");
    const created = await createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot,
      agentName: "Package Agent",
      agentId: "pkg:package-agent",
      packageName: "pkg",
      sessionId: "session-1",
      skillNames: ["declared-skill"],
      approvedAgentIds: ["package-agent"],
    });

    const valid = await assertExpertRuntimeContract({
      workspace,
      sessionId: "session-1",
      directory: created.directory,
      agent: "package-agent",
      runtimeRoot,
      promptBody: { agent: "package-agent", parts: [{ type: "text", text: "hello" }] },
    });
    expect(valid).toMatchObject({
      contractVersion: 3,
      sessionId: "session-1",
      agent: "package-agent",
      declaredSkills: ["declared-skill"],
      installedSkills: [],
      missingSkills: ["declared-skill"],
    });
    expect(getExpertLifecycleEventsSnapshot().events.filter((event) => event.kind === "contract_assertion")).toHaveLength(1);

    await writeFile(join(created.directory, "opencode.json"), JSON.stringify({
      default_agent: "sisyphus",
      plugin: ["home-plugin"],
    }));
    await expect(assertExpertRuntimeContract({
      workspace,
      sessionId: "session-1",
      directory: created.directory,
      runtimeRoot,
    })).rejects.toMatchObject({
      code: "expert_runtime_contract_violated",
      violationCode: "default_agent",
    });
    const failures = getExpertLifecycleEventsSnapshot().events.filter((event) =>
      event.kind === "contract_assertion" && event.outcome === "failed",
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ code: "default_agent", assertion: "agent" });
    resetExpertLifecycleEventsForTest();
    const callbacks: unknown[] = [];
    await ensureAndAssertExpertRuntimeContract({
      workspace,
      sessionId: "session-1",
      directory: created.directory,
      runtimeRoot,
    }, { onViolation: (event) => callbacks.push(event) });
    expect(callbacks).toHaveLength(1);
    expect(getExpertLifecycleEventsSnapshot().events.filter((event) =>
      event.kind === "contract_assertion" && event.outcome === "failed",
    )).toHaveLength(1);
  });

  test("lazy ensure repairs once and reasserts before accepting a pending v2 marker", async () => {
    const workspace = testWorkspace(join(root, "workspace-lazy"));
    await mkdir(workspace.path, { recursive: true });
    const runtimeRoot = join(root, "runtime-lazy");
    const created = await createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot,
      agentName: "Legacy Agent",
      agentId: "legacy-agent",
      packageName: "legacy-package",
      sessionKey: "1786347548004",
    });
    const markerPath = join(created.directory, "onmyagent-session.json");
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as Record<string, unknown>;
    delete marker.agentId;
    delete marker.packageName;
    delete marker.sessionId;
    marker.isolationVersion = 2;
    await writeFile(markerPath, JSON.stringify(marker));

    const results = await Promise.all([
      ensureAndAssertExpertRuntimeContract({
        workspace,
        sessionId: "session-lazy",
        directory: created.directory,
        runtimeRoot,
      }),
      ensureAndAssertExpertRuntimeContract({
        workspace,
        sessionId: "session-lazy",
        directory: created.directory,
        runtimeRoot,
      }),
    ]);
    expect(results[0].marker.isolationVersion).toBe(3);
    expect(results[1].sessionId).toBe("session-lazy");
  });

  test("fails closed when materialized skills diverge from the marker", async () => {
    const workspace = testWorkspace(join(root, "workspace-skills"));
    await mkdir(workspace.path, { recursive: true });
    const runtimeRoot = join(root, "runtime-skills");
    const created = await createExpertSessionRuntimeDirectory({
      workspace,
      runtimeRoot,
      agentName: "Skills Agent",
      agentId: "skills-agent",
      packageName: "skills-package",
      sessionId: "session-skills",
    });
    await mkdir(join(created.directory, ".opencode", "skills", "rogue-skill"), { recursive: true });
    await expect(assertExpertRuntimeContract({
      workspace,
      sessionId: "session-skills",
      directory: created.directory,
      runtimeRoot,
    })).rejects.toMatchObject({
      violationCode: "skills_mismatch",
    });
    const repaired = await ensureAndAssertExpertRuntimeContract({
      workspace,
      sessionId: "session-skills",
      directory: created.directory,
      runtimeRoot,
    });
    expect(repaired.installedSkills).toEqual([]);
    expect(await assertExpertRuntimeContract({
      workspace,
      sessionId: "session-skills",
      directory: created.directory,
      runtimeRoot,
    })).toMatchObject({ installedSkills: [] });
  });

  test("counts system and text parts and enforces the 8,000-token gate", () => {
    const body = {
      agent: "onmyagent",
      tools: { read: true, write: true },
      system: "system context ".repeat(20_000),
      parts: [{ type: "text", text: "first user turn" }],
    };
    const tokens = estimateExpertPromptTokens(body);
    expect(tokens).toBeGreaterThan(EXPERT_PROMPT_TOKEN_LIMIT);
    expect(() => assertExpertPromptTokenBudget({
      workspace: testWorkspace(join(root, "workspace-token")),
      sessionId: "token-session",
      directory: join(root, "runtime-token"),
      promptBody: body,
    })).toThrow(ExpertRuntimeContractError);
    expect(getExpertLifecycleEventsSnapshot().events.filter((event) =>
      event.kind === "contract_assertion" && event.code === "prompt_budget_exceeded",
    )).toHaveLength(1);
  });

  test("does not count file data URLs toward the 8,000-token text budget", () => {
    const body = {
      agent: "onmyagent",
      parts: [
        { type: "text", text: "这是相关资料，你先看一下" },
        {
          type: "file",
          filename: "项目表.xlsx",
          mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          url: `data:application/octet-stream;base64,${"A".repeat(600_000)}`,
        },
      ],
    };
    const tokens = estimateExpertPromptTokens(body);
    expect(tokens).toBeLessThan(EXPERT_PROMPT_TOKEN_LIMIT);
    expect(assertExpertPromptTokenBudget({
      workspace: testWorkspace(join(root, "workspace-file-budget")),
      sessionId: "file-budget-session",
      directory: join(root, "runtime-file-budget"),
      promptBody: body,
    })).toBe(tokens);
  });
});

function testWorkspace(path: string): WorkspaceInfo {
  return {
    id: "ws_contract",
    name: "Contract workspace",
    path,
    preset: "default",
    workspaceType: "local",
  };
}
