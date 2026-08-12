import { describe, expect, test } from "bun:test";

import {
  expertPackageMatchesAgentId,
  filterLocalShelfExperts,
  isLocalShelfPackage,
} from "../src/react-app/domains/plugins/expert-marketplace/data";
import { isAlreadySummonedExpert } from "../src/react-app/domains/plugins/expert-marketplace/expert-marketplace-dialog";
import type { ExpertMarketplaceEntry } from "../src/react-app/domains/plugins/expert-marketplace/types";

function stub(
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
    ...partial,
  };
}

describe("local expert shelf filter", () => {
  test("package matcher embeds packageName in session agent ids", () => {
    const expert = stub({
      id: "kol-media:kol-media-specialist",
      packageName: "kol-media-specialist",
      source: "installed",
    });
    expect(
      expertPackageMatchesAgentId(
        expert,
        "媒介专家-kol-media-specialistkol-media-specialist",
      ),
    ).toBe(true);
    expect(expertPackageMatchesAgentId(expert, "kol-media-specialist")).toBe(
      true,
    );
    expect(expertPackageMatchesAgentId(expert, "unrelated-agent")).toBe(false);
  });

  test("shelf keeps mine always; installed only when agent has sessions", () => {
    const experts = [
      stub({
        id: "a:kol-media-specialist",
        packageName: "kol-media-specialist",
        source: "installed",
      }),
      stub({
        id: "b:warehouse-manager",
        packageName: "warehouse-manager",
        source: "installed",
      }),
      stub({
        id: "c:my-custom",
        packageName: "my-custom",
        source: "mine",
      }),
      stub({
        id: "builtin:x",
        packageName: "x",
        source: "builtin",
      }),
    ];

    // Explicit empty scope (expert host, no sidebar sessions) → only self-created.
    expect(
      filterLocalShelfExperts(experts, []).map((e) => e.packageName),
    ).toEqual(["my-custom"]);

    // No scope signal (main 市场 rail) → all installed + mine, never builtin.
    expect(
      filterLocalShelfExperts(experts, undefined).map((e) => e.packageName),
    ).toEqual(["kol-media-specialist", "warehouse-manager", "my-custom"]);
    expect(
      filterLocalShelfExperts(experts).map((e) => e.packageName),
    ).toEqual(["kol-media-specialist", "warehouse-manager", "my-custom"]);

    // Active media expert session → media install + mine (not warehouse preseed).
    expect(
      filterLocalShelfExperts(experts, [
        "媒介专家-kol-media-specialistkol-media-specialist",
      ]).map((e) => e.packageName),
    ).toEqual(["kol-media-specialist", "my-custom"]);

    expect(isLocalShelfPackage({ source: "installed" })).toBe(true);
    expect(isLocalShelfPackage({ source: "builtin" })).toBe(false);
  });

  test("market cards match summoned packages by packageName across id shapes", () => {
    const shelf = [
      stub({
        id: "fleet-management-specialist:fleet-management-specialist",
        packageName: "fleet-management-specialist",
        source: "installed",
      }),
    ];
    // Builtin market catalog id may differ; packageName is the stable key.
    expect(
      isAlreadySummonedExpert(
        {
          id: "fleet-management-specialist:fleet-management-specialist",
          packageName: "fleet-management-specialist",
        },
        shelf,
      ),
    ).toBe(true);
    expect(
      isAlreadySummonedExpert(
        { id: "other-id", packageName: "fleet-management-specialist" },
        shelf,
      ),
    ).toBe(true);
    expect(
      isAlreadySummonedExpert(
        { id: "x", packageName: "warehouse-manager" },
        shelf,
      ),
    ).toBe(false);
  });
});
