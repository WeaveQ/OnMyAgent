import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

function readWorkspaceFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("session shared page layouts", () => {
  test("file, management, tool, and channel pages use full-width content containers", () => {
    const filesPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/components/shared-pages/workspace-files-page.tsx",
    );
    const managementPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/components/shared-pages/agent-management-page.tsx",
    );
    const channelsPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/components/shared-pages/messaging-channels-page.tsx",
    );
    const toolsPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/plugins/plugins-page.tsx",
    );

    expect(filesPage).toContain('className="flex h-full w-full flex-col"');
    expect(filesPage).not.toContain("max-w-[1180px]");
    expect(managementPage).not.toContain('"mx-auto w-full max-w-7xl"');
    expect(channelsPage).toContain('className="w-full"');
    expect(channelsPage).not.toContain("mx-auto max-w-screen-2xl");
    expect(toolsPage).toContain('pageContainer: "w-full px-8 pb-10 pt-7"');
    expect(toolsPage).toContain('pluginPageContainer: "w-full space-y-10 px-8 pb-10 pt-7"');
    expect(toolsPage).not.toContain("mx-auto w-full max-w-screen-2xl");
  });

  test("cloud drive tab uses a dedicated empty state instead of task file controls", () => {
    const sharedFilesPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/components/shared-pages/workspace-files-page.tsx",
    );
    const legacyFilesPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/session/chat/session-page-workspace-files-page.tsx",
    );
    const imagePath = join(
      repoRoot,
      "apps/app/public/empty-states/cloud-drive-placeholder.png",
    );

    for (const filesPage of [sharedFilesPage, legacyFilesPage]) {
      expect(filesPage).toContain("CloudDriveEmptyState");
      expect(filesPage).toContain("cloud-drive-placeholder.png");
      expect(filesPage).toContain('t("files.cloud_empty_title")');
      expect(filesPage).toContain('t("files.cloud_empty_description")');
      expect(filesPage).not.toContain('t("files.cloud_coming_soon")');
    }
    expect(sharedFilesPage).toContain('activeTab === "cloud" ? (');
    expect(existsSync(imagePath)).toBe(true);
  });
});
