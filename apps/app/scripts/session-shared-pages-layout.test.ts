import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

function readWorkspaceFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("session shared page layouts", () => {
  test("extracted domain pages live outside shared-pages and keep wide content containers", () => {
    const filesPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/workspace/workspace-files-page.tsx",
    );
    const managementPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/local-agents/agent-management/agent-management-page.tsx",
    );
    const channelsPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/messaging/messaging-channels-page.tsx",
    );
    const toolsPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/plugins/plugins-page.tsx",
    );

    expect(filesPage).toContain('className="flex h-full w-full flex-col"');
    expect(filesPage).not.toContain("max-w-[1180px]");
    expect(managementPage).not.toContain('"mx-auto w-full max-w-7xl"');
    expect(channelsPage).toContain('className="w-full"');
    expect(channelsPage).not.toContain("mx-auto max-w-screen-2xl");
    // plugins / skills marketplace: full-width content (match skills tab, no max-w squeeze)
    expect(toolsPage).toContain('pageContainer: "mx-auto w-full px-6 pb-10 pt-5"');
    expect(toolsPage).toContain(
      'pluginPageContainer: "mx-auto w-full space-y-8 px-6 pb-10 pt-5"',
    );
    expect(toolsPage).not.toContain("max-w-5xl");
    expect(toolsPage).not.toContain("mx-auto w-full max-w-screen-2xl");
  });

  test("cloud drive tab uses a dedicated empty state instead of task file controls", () => {
    const filesPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/workspace/workspace-files-page.tsx",
    );

    expect(filesPage).toContain("CloudDriveEmptyState");
    expect(filesPage).toContain("CloudDriveIllustration");
    expect(filesPage).toContain('t("files.cloud_empty_title")');
    expect(filesPage).toContain('t("files.cloud_empty_description")');
    expect(filesPage).not.toContain('t("files.cloud_coming_soon")');
    expect(filesPage).not.toContain("cloud-drive-placeholder.png");
    expect(filesPage).toContain('activeTab === "cloud" ? (');
    expect(filesPage).toContain('fill="currentColor"');
  });
});
