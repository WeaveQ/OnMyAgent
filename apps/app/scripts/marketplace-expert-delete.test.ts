import { describe, expect, test } from "bun:test";

import { OnMyAgentServerError } from "../src/app/lib/onmyagent-server";
import {
  expertDeleteIdentityEquals,
  resolveMarketplaceExpertHardDeleteTarget,
} from "../src/react-app/domains/session/pages/use-expert-hard-delete-ui";
import {
  awaitExpertDeleteStep,
  isExpertDeleteTargetNotFound,
  resolveExpertDeleteSessionDirectory,
  resolveExpertPackageDeleteMarketplace,
  runExpertHardDelete,
  realExpertDeleteSessionIds,
  shouldContinueExpertDeleteAfterServerError,
  shouldProceedWithDesktopPackageDelete,
  shouldSkipServerExpertSessionDelete,
} from "../src/react-app/domains/session/pages/use-expert-session-delete";
import type { ExpertPackageDeleteInput, ExpertPackageDeleteResult } from "@onmyagent/types/desktop-ipc";
import type { ExpertDeleteRequest, ExpertDeleteResult } from "@onmyagent/types/server";
import type { ExpertMarketplaceEntry } from "../src/react-app/domains/plugins/expert-marketplace/types";
import type { AgentConversationGroup } from "../src/react-app/domains/session/sidebar/conversation-model";

function stubExpert(
  partial: Pick<ExpertMarketplaceEntry, "id" | "packageName" | "source"> &
    Partial<ExpertMarketplaceEntry>,
): ExpertMarketplaceEntry {
  return {
    displayName: partial.packageName,
    profession: partial.packageName,
    description: "",
    categoryId: "all",
    categoryIds: [],
    categoryLabel: "",
    categoryLabels: [],
    tags: [],
    quickPrompts: [],
    promptTemplates: [],
    avatarUrl: null,
    expertType: "agent",
    leadAgentName: partial.packageName,
    systemPrompt: "",
    version: null,
    teamWorkflow: null,
    packagePath: `/tmp/${partial.packageName}`,
    skills: [],
    introStyle: "default",
    approvedAgentIds: [],
    ...partial,
  };
}

function stubGroup(
  agentId: string,
  sessionIds: string[],
  directories: Record<string, string> = {},
): AgentConversationGroup {
  const sessions = sessionIds.map((id) => ({
    id,
    title: id,
    ...(directories[id] ? { directory: directories[id] } : {}),
  }));
  return {
    key: agentId,
    agentId,
    name: agentId,
    description: "",
    avatarUrl: null,
    avatarBackground: "",
    sessions,
    latestSession: sessions[0] ?? { id: "none", title: "none" },
  };
}

describe("marketplace expert hard-delete target", () => {
  test("refuses catalog cards but allows summoned installs", () => {
    expect(
      resolveMarketplaceExpertHardDeleteTarget({
        expert: stubExpert({
          id: "builtin:pkg",
          packageName: "pkg",
          source: "builtin",
        }),
        conversationGroups: [],
        registry: null,
      }),
    ).toBeNull();
    expect(
      resolveMarketplaceExpertHardDeleteTarget({
        expert: stubExpert({
          id: "pkg:pkg",
          packageName: "pkg",
          source: "installed",
          displayName: "Summoned",
        }),
        conversationGroups: [stubGroup("pkg:pkg", ["ses_1"])],
        registry: null,
      }),
    ).toEqual({
      agentId: "pkg:pkg",
      name: "Summoned",
      sessionIds: ["ses_1"],
      packageName: "pkg",
      source: "installed",
    });
  });

  test("does not attach another expert whose id merely contains the package name", () => {
    const expert = stubExpert({
      id: "ops:ops",
      packageName: "ops",
      source: "mine",
      displayName: "Ops",
    });
    expect(expertDeleteIdentityEquals(expert, "kol-ops:kol-ops")).toBe(false);
    expect(expertDeleteIdentityEquals(expert, "foo:kol-ops")).toBe(false);
    expect(expertDeleteIdentityEquals(expert, "ops:ops")).toBe(true);
    expect(
      resolveMarketplaceExpertHardDeleteTarget({
        expert,
        conversationGroups: [
          stubGroup("kol-ops:kol-ops", ["ses_kol"]),
          stubGroup("ops:ops", ["ses_ops"]),
        ],
        registry: null,
      }),
    ).toEqual({
      agentId: "ops:ops",
      name: "Ops",
      sessionIds: ["ses_ops"],
      packageName: "ops",
      source: "mine",
    });
  });

  test("self-created experts delete even with no sessions", () => {
    expect(
      resolveMarketplaceExpertHardDeleteTarget({
        expert: stubExpert({
          id: "review:review",
          packageName: "review",
          source: "mine",
          displayName: "Review expert",
        }),
        conversationGroups: [],
        registry: null,
      }),
    ).toEqual({
      agentId: "review:review",
      name: "Review expert",
      sessionIds: [],
      packageName: "review",
      source: "mine",
    });
  });

  test("collects non-draft sessions from matching conversation groups", () => {
    const expert = stubExpert({
      id: "ops:ops",
      packageName: "ops",
      source: "mine",
      displayName: "Ops",
    });
    expect(
      resolveMarketplaceExpertHardDeleteTarget({
        expert,
        conversationGroups: [
          stubGroup("ops:ops", ["ses_1", "draft:ops", "ses_2"], {
            ses_1: "experts/报价作业-ops/ses_1",
          }),
          stubGroup("other", ["ses_other"]),
        ],
        registry: null,
      }),
    ).toEqual({
      agentId: "ops:ops",
      name: "Ops",
      sessionIds: ["ses_1", "ses_2"],
      packageName: "ops",
      source: "mine",
      sessionDirectories: { ses_1: "experts/报价作业-ops/ses_1" },
    });
  });
});

describe("expert delete marketplace and directory resolution", () => {
  test("maps shelf source onto a single desktop marketplace root", () => {
    expect(
      resolveExpertPackageDeleteMarketplace({ source: "installed", agentId: "a" }),
    ).toBe("experts");
    expect(
      resolveExpertPackageDeleteMarketplace({ source: "mine", agentId: "a" }),
    ).toBe("my-experts");
  });

  test("maps a registry-only summoned agent to the experts install root", () => {
    const registry = {
      version: 1 as const,
      updatedAt: "2026-01-01T00:00:00.000Z",
      avatars: [],
      templates: [],
      agents: [
        {
          id: "summoned",
          name: "Summoned",
          marketplaceSource: "installed" as const,
        },
        {
          id: "custom",
          name: "Custom",
          marketplaceSource: "mine" as const,
        },
      ],
      skills: [],
    };
    expect(
      resolveExpertPackageDeleteMarketplace({
        agentId: "summoned",
        registry: registry as never,
      }),
    ).toBe("experts");
    expect(
      resolveExpertPackageDeleteMarketplace({
        agentId: "custom",
        registry: registry as never,
      }),
    ).toBe("my-experts");
  });

  test("prefers the session directory carried on the delete target", () => {
    expect(
      resolveExpertDeleteSessionDirectory({
        sessionId: "ses_1",
        sessionDirectories: { ses_1: "experts/报价作业-ops/ses_1" },
        currentAgentSessions: [],
      }),
    ).toBe("experts/报价作业-ops/ses_1");
    expect(
      resolveExpertDeleteSessionDirectory({
        sessionId: "ses_1",
        currentAgentSessions: [{ id: "ses_other", directory: "experts/other/ses_other" }],
        archivedDirectory: null,
      }),
    ).toBeNull();
  });
});

describe("expert delete 404", () => {
  test("treats missing origin rows as package-only cleanup", () => {
    expect(
      isExpertDeleteTargetNotFound(
        new OnMyAgentServerError(404, "expert_delete_target_not_found", "missing"),
      ),
    ).toBe(true);
    expect(
      isExpertDeleteTargetNotFound(new OnMyAgentServerError(409, "expert_builtin_delete_forbidden", "no")),
    ).toBe(false);
    expect(isExpertDeleteTargetNotFound(new Error("expert_delete_target_not_found"))).toBe(true);
    expect(isExpertDeleteTargetNotFound(new Error("other"))).toBe(false);
  });

  test("continues desktop uninstall when leftover sessions have no origins", () => {
    const missing = new OnMyAgentServerError(404, "expert_delete_target_not_found", "missing");
    expect(shouldContinueExpertDeleteAfterServerError(missing)).toBe(true);
    expect(shouldSkipServerExpertSessionDelete([])).toBe(false);
    expect(realExpertDeleteSessionIds([])).toEqual([]);
    expect(shouldSkipServerExpertSessionDelete(["draft:ws:agent-3444"])).toBe(true);
    expect(shouldSkipServerExpertSessionDelete(["ses_real"])).toBe(false);
    expect(
      shouldProceedWithDesktopPackageDelete({
        source: "mine",
        sessionIds: ["ses_leftover"],
        serverMissed: true,
      }),
    ).toBe(true);
    expect(
      shouldProceedWithDesktopPackageDelete({
        source: "mine",
        sessionIds: [],
        serverMissed: false,
      }),
    ).toBe(true);
    expect(
      shouldProceedWithDesktopPackageDelete({
        source: "installed",
        sessionIds: ["ses_1"],
        serverMissed: false,
        serverResult: { state: "failed", steps: [] },
      }),
    ).toBe(false);
  });

  test("awaitExpertDeleteStep rejects hung server/desktop work so busy can clear", async () => {
    await expect(
      awaitExpertDeleteStep(new Promise(() => undefined), 20, "expert_delete_server"),
    ).rejects.toThrow("expert_delete_server_timeout");
    await expect(awaitExpertDeleteStep(Promise.resolve("ok"), 50, "expert_delete_desktop")).resolves.toBe(
      "ok",
    );
  });
});

function completedPackage(input: ExpertPackageDeleteInput): ExpertPackageDeleteResult {
  return {
    ok: true,
    operationId: input.operationId,
    packageName: input.packageName,
    state: "completed",
    steps: [{ target: input.marketplace, state: "completed" }],
    removedSkills: [],
  };
}

const leftoverHardDelete = {
  workspaceId: "ws_local",
  operationId: "op-3444",
  agentId: "3444:3444",
  packageName: "3444",
  marketplace: "my-experts" as const,
  sessionIds: ["ses_leftover_3444"],
  source: "mine" as const,
};

describe("runExpertHardDelete shipped RPCs", () => {
  test("leftover sessionIds + 404 still invoke deleteExpertPackage", async () => {
    const expertCalls: Array<[string, ExpertDeleteRequest]> = [];
    const packageCalls: ExpertPackageDeleteInput[] = [];
    const result = await runExpertHardDelete(leftoverHardDelete, {
      deleteExpert: async (workspaceId, request) => {
        expertCalls.push([workspaceId, request]);
        throw new OnMyAgentServerError(404, "expert_delete_target_not_found", "missing origins");
      },
      deleteExpertPackage: async (input) => {
        packageCalls.push(input);
        return completedPackage(input);
      },
    });
    expect(expertCalls.map(([, request]) => request.sessionIds)).toEqual([
      ["ses_leftover_3444"],
      [],
    ]);
    expect(expertCalls[0]?.[0]).toBe("ws_local");
    expect(packageCalls).toEqual([
      {
        operationId: "op-3444",
        agentId: "3444:3444",
        packageName: "3444",
        marketplace: "my-experts",
      },
    ]);
    expect(result.serverMissed).toBe(true);
    expect(result.desktop.state).toBe("completed");
  });

  test("hung deleteExpert times out so busy can clear without calling deleteExpertPackage", async () => {
    const packageCalls: ExpertPackageDeleteInput[] = [];
    await expect(
      runExpertHardDelete(leftoverHardDelete, {
        timeoutMs: 25,
        deleteExpert: () => new Promise<ExpertDeleteResult>(() => undefined),
        deleteExpertPackage: async (input) => {
          packageCalls.push(input);
          return completedPackage(input);
        },
      }),
    ).rejects.toThrow("expert_delete_server_timeout");
    expect(packageCalls).toEqual([]);
  });

  test("hung deleteExpertPackage after leftover 404 times out so busy can clear", async () => {
    const expertCalls: Array<[string, ExpertDeleteRequest]> = [];
    await expect(
      runExpertHardDelete(leftoverHardDelete, {
        timeoutMs: 25,
        deleteExpert: async (workspaceId, request) => {
          expertCalls.push([workspaceId, request]);
          throw new OnMyAgentServerError(404, "expert_delete_target_not_found", "missing origins");
        },
        deleteExpertPackage: () => new Promise<ExpertPackageDeleteResult>(() => undefined),
      }),
    ).rejects.toThrow("expert_delete_desktop_timeout");
    expect(expertCalls.map(([, request]) => request.sessionIds)).toEqual([
      ["ses_leftover_3444"],
      [],
    ]);
  });

  test("empty sessionIds still call deleteExpert so remaining origins are deleted", async () => {
    const expertCalls: Array<[string, ExpertDeleteRequest]> = [];
    const packageCalls: ExpertPackageDeleteInput[] = [];
    await runExpertHardDelete(
      { ...leftoverHardDelete, sessionIds: [] },
      {
        deleteExpert: async (workspaceId, request) => {
          expertCalls.push([workspaceId, request]);
          throw new OnMyAgentServerError(404, "expert_delete_target_not_found", "no origins");
        },
        deleteExpertPackage: async (input) => {
          packageCalls.push(input);
          return completedPackage(input);
        },
      },
    );
    expect(expertCalls).toHaveLength(1);
    expect(expertCalls[0]?.[1]?.sessionIds).toEqual([]);
    expect(packageCalls).toHaveLength(1);
  });

  test("leftover 404 then remaining origins still uninstall after origin cleanup", async () => {
    const expertCalls: string[][] = [];
    const result = await runExpertHardDelete(leftoverHardDelete, {
      deleteExpert: async (_workspaceId, request) => {
        expertCalls.push(request.sessionIds ?? []);
        if ((request.sessionIds?.length ?? 0) > 0) {
          throw new OnMyAgentServerError(404, "expert_delete_target_not_found", "leftover");
        }
        return {
          operationId: request.operationId,
          workspaceId: leftoverHardDelete.workspaceId,
          agentId: request.agentId,
          packageName: request.packageName,
          revision: 2,
          state: "completed",
          steps: [
            {
              sessionId: "ses_origin",
              openCode: "completed",
              runtime: "completed",
              tombstone: "completed",
            },
          ],
        };
      },
      deleteExpertPackage: async (input) => completedPackage(input),
    });
    expect(expertCalls).toEqual([["ses_leftover_3444"], []]);
    expect(result.serverMissed).toBe(false);
    expect(result.server?.steps[0]?.sessionId).toBe("ses_origin");
    expect(result.desktop.state).toBe("completed");
  });
});
