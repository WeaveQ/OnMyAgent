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

    // Files shell: full-height column (P0 three-source page).
    expect(filesPage).toContain('className="flex h-full w-full min-h-0 flex-col');
    expect(filesPage).not.toContain("max-w-[1180px]");
    expect(managementPage).not.toContain('"mx-auto w-full max-w-7xl"');
    expect(channelsPage).toContain('className="w-full"');
    expect(channelsPage).not.toContain("mx-auto max-w-screen-2xl");
    // plugins / skills marketplace: full-width content (no max-w squeeze)
    expect(toolsPage).toContain('pageContainer: "w-full px-6 pb-10 pt-5"');
    expect(toolsPage).not.toContain("max-w-5xl");
    expect(toolsPage).not.toContain("mx-auto w-full max-w-screen-2xl");
  });

  test("files page uses three-source tabs instead of cloud drive empty state", () => {
    const filesPage = readWorkspaceFile(
      "apps/app/src/react-app/domains/workspace/workspace-files-page.tsx",
    );

    expect(filesPage).toContain("FILES_SOURCE_TABS");
    expect(filesPage).toContain("DEFAULT_FILES_SOURCE_TAB");
    expect(filesPage).toContain("WorkspaceFilesUploadsPanel");
    expect(filesPage).toContain("WorkspaceFilesBrowserPanel");
    expect(filesPage).toContain('sourceTab={activeTab === "expert" ? "expert" : "task"}');
    expect(filesPage).not.toContain("CloudDriveEmptyState");
    expect(filesPage).not.toContain("CloudDriveIllustration");
    expect(filesPage).not.toContain('activeTab === "cloud"');
    expect(filesPage).not.toContain('t("files.cloud_empty_title")');
  });
});
