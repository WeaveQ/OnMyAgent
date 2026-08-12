import { describe, expect, test } from "bun:test";

import type { ExpertPackageListEntry } from "../src/app/lib/desktop";
import { isVisibleExpertPackageEntry } from "../src/react-app/domains/session/pages/shared-page-utils";

function entry(
  partial: Partial<ExpertPackageListEntry> &
    Pick<ExpertPackageListEntry, "id" | "packageName" | "source">,
): ExpertPackageListEntry {
  return {
    packagePath: `/tmp/${partial.packageName}`,
    displayName: partial.packageName,
    profession: partial.packageName,
    description: "",
    categoryId: "all",
    tags: [],
    quickPrompts: [],
    promptTemplates: [],
    avatarUrl: null,
    expertType: "agent",
    leadAgentName: partial.packageName,
    systemPrompt: "",
    version: null,
    teamWorkflow: null,
    skills: [],
    introStyle: "default",
    approvedAgentIds: [],
    ...partial,
  } as ExpertPackageListEntry;
}

describe("isVisibleExpertPackageEntry", () => {
  test("hides packages whose path segment is .expert-plugin", () => {
    expect(
      isVisibleExpertPackageEntry(
        entry({
          id: "x",
          packageName: "x",
          source: "installed",
          packagePath: "/tmp/.expert-plugin/x",
        }),
      ),
    ).toBe(false);
  });

  test("does not throw when displayName or packagePath is missing", () => {
    expect(
      isVisibleExpertPackageEntry(
        entry({
          id: "y",
          packageName: "y",
          source: "mine",
          displayName: undefined as unknown as string,
          packagePath: undefined as unknown as string,
        }),
      ),
    ).toBe(true);
  });
});
