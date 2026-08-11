import { describe, expect, test } from "bun:test";
import type {
  ExpertPackageDeleteInput,
  ExpertPackageDeleteResult,
} from "@onmyagent/types/desktop-ipc";

import {
  canHardDeleteExpert,
  deleteExpertPackageForAgent,
  packageNameCandidatesForAgent,
  packageNameForAgent,
} from "../src/react-app/domains/agents/expert-hard-delete";
import type { AgentRegistry } from "../src/react-app/domains/agents";
import { EXPERT_CREATION_COACH_AGENT_ID } from "../src/react-app/domains/agents";

function emptyRegistry(agents: AgentRegistry["agents"] = []): AgentRegistry {
  return {
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
    avatars: [],
    templates: [],
    agents,
    skills: [],
  };
}

describe("expert hard delete", () => {
  test("blocks product builtin coach", () => {
    expect(canHardDeleteExpert(EXPERT_CREATION_COACH_AGENT_ID, emptyRegistry())).toBe(
      false,
    );
    expect(
      canHardDeleteExpert(
        "user-expert",
        emptyRegistry([
          {
            id: "user-expert",
            name: "Mine",
            description: "",
            quote: "",
            tone: "friendly",
            avatarStyle: "lorelei",
            avatarOptionId: "lorelei-mentor",
            customAvatarDataUrl: null,
            modelProvider: "auto",
            model: "Auto",
            enabledToolIds: [],
            defaultWorkspace: "",
            skillIds: [],
            preferredName: "",
            preferredLanguage: "zh",
            userNote: "",
            userBackground: "",
            sourceTemplateId: null,
            marketplaceSource: "mine",
            marketplacePackageName: "user-expert",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ]),
      ),
    ).toBe(true);
  });

  test("package name candidates include marketplace package name", () => {
    const registry = emptyRegistry([
      {
        id: "agent-1",
        name: "A",
        description: "",
        quote: "",
        tone: "friendly",
        avatarStyle: "lorelei",
        avatarOptionId: "lorelei-mentor",
        customAvatarDataUrl: null,
        modelProvider: "auto",
        model: "Auto",
        enabledToolIds: [],
        defaultWorkspace: "",
        skillIds: [],
        preferredName: "",
        preferredLanguage: "zh",
        userNote: "",
        userBackground: "",
        sourceTemplateId: null,
        marketplacePackageName: "pkg-a",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(packageNameCandidatesForAgent({ agentId: "agent-1", registry }).sort()).toEqual([
      "agent-1",
      "pkg-a",
    ]);
    expect(packageNameForAgent({ agentId: "agent-1", registry })).toBe("pkg-a");
  });

  test("uses the replay-safe custom package delete contract", async () => {
    const calls: Array<{ operationId: string; packageName: string; marketplace: string }> = [];
    await deleteExpertPackageForAgent(
      { agentId: "agent-1", packageName: "pkg-a" },
      {
        createOperationId: () => "op-package",
        operationIds: new Map(),
        deletePackage: async (input) => {
          calls.push(input);
          return {
            ok: true,
            operationId: input.operationId,
            packageName: input.packageName,
            state: "completed",
            steps: [],
            removedSkills: [],
          };
        },
      },
    );

    expect(calls).toEqual([
      { operationId: "op-package", agentId: "agent-1", packageName: "pkg-a", marketplace: "my-experts" },
    ]);
  });

  test("reuses the same operation id after a partial desktop result", async () => {
    const operationIds = new Map<string, string>();
    const calls: string[] = [];
    let partial = true;
    const dependencies = {
      createOperationId: () => "op-partial",
      operationIds,
      deletePackage: async (
        input: ExpertPackageDeleteInput,
      ): Promise<ExpertPackageDeleteResult> => {
        calls.push(input.operationId);
        const state = partial ? "partial" as const : "completed" as const;
        partial = false;
        return {
          ok: true as const,
          operationId: input.operationId,
          packageName: input.packageName,
          state,
          steps: state === "partial"
            ? [{ target: "registry" as const, state: "pending" as const }]
            : [],
          removedSkills: [],
        };
      },
    };
    await expect(
      deleteExpertPackageForAgent({ agentId: "agent-1", packageName: "pkg-a" }, dependencies),
    ).rejects.toThrow("expert_package_delete_incomplete");
    await deleteExpertPackageForAgent(
      { agentId: "agent-1", packageName: "pkg-a" },
      dependencies,
    );
    expect(calls).toEqual(["op-partial", "op-partial"]);
    expect(operationIds.size).toBe(0);
  });
});
