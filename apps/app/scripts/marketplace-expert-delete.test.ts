import { describe, expect, test } from "bun:test";

import { OnMyAgentServerError } from "../src/app/lib/onmyagent-server";
import {
  expertDeleteIdentityEquals,
  resolveMarketplaceExpertHardDeleteTarget,
} from "../src/react-app/domains/session/pages/use-expert-hard-delete-ui";
import {
  isExpertDeleteTargetNotFound,
  resolveExpertDeleteSessionDirectory,
  resolveExpertPackageDeleteMarketplace,
} from "../src/react-app/domains/session/pages/use-expert-session-delete";
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
});
