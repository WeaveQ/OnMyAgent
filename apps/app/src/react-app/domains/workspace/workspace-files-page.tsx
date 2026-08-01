/** @jsxImportSource react */
/**
 * Primary-rail Files page (P0 three-source IA + path heuristics).
 * Rail: Mine / Tasks / Experts / Projects (Projects coming soon, disabled)
 * - Mine: inbox list + import-by-copy
 * - Tasks: workspace browser excluding expert agent folders
 * - Experts: workspace browser of expert agent folders only
 * - Projects: not yet open
 */
import { useState } from "react";
import { Bot, FileStack, FileUp, FolderKanban } from "lucide-react";

import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { shellChrome } from "@/react-app/design-system/type-scale";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import type { OpenTarget } from "../../capabilities/artifacts/open-target";
import {
  DEFAULT_FILES_SOURCE_TAB,
  FILES_SOURCE_RAIL_TABS,
  filesSourceTabLabelKey,
  isFilesSourceRailTabEnabled,
  type FilesSourceTab,
} from "./workspace-files-model";
import { WorkspaceFilesBrowserPanel } from "./workspace-files-browser-panel";
import { WorkspaceFilesUploadsPanel } from "./workspace-files-uploads-panel";

// Re-export pure root resolver for existing callers/tests.
export { resolveToolWorkspaceFileRoot } from "./workspace-files-model";

function filesSourceTabIcon(tab: (typeof FILES_SOURCE_RAIL_TABS)[number]) {
  switch (tab) {
    case "uploads":
      return FileUp;
    case "task":
      return FileStack;
    case "expert":
      return Bot;
    case "project":
      return FolderKanban;
  }
}

export function WorkspaceFilesPage(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  workspaceRoot: string;
  /**
   * Directory to list. Callers should pass the OnMyAgent-selected workspace
   * folder (`workspaceRoot`).
   */
  fileRoot?: string | null;
  onOpenArtifact?: (target: OpenTarget) => Promise<void> | void;
  onEditError?: () => void;
  onAddToTask?: (relativePath: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<FilesSourceTab>(
    DEFAULT_FILES_SOURCE_TAB,
  );

  return (
    <div className="flex h-full w-full min-h-0 flex-col bg-dls-background text-dls-text">
      <div className={cn(shellChrome.pageHeaderSimple, "border-b-0")}>
        {/* Free-float source pills — NavTab active fill only (no raw bg-white). */}
        <SegmentedTabGroup density="bare" role="tablist">
          {FILES_SOURCE_RAIL_TABS.map((tab) => {
            const Icon = filesSourceTabIcon(tab);
            const enabled = isFilesSourceRailTabEnabled(tab);
            const active = enabled && activeTab === tab;
            return (
              <NavTabButton
                key={tab}
                active={active}
                type="button"
                role="tab"
                disabled={!enabled}
                title={
                  enabled
                    ? undefined
                    : t("files.source_project_coming_soon")
                }
                onClick={() => {
                  if (!enabled) return;
                  setActiveTab(tab);
                }}
                size="tab"
                shape="tab"
                aria-selected={active}
                aria-disabled={!enabled}
                aria-current={active ? "page" : undefined}
                className={cn(
                  !enabled &&
                    "cursor-not-allowed opacity-45 hover:bg-transparent hover:text-dls-secondary",
                )}
              >
                <Icon aria-hidden />
                <span>{t(filesSourceTabLabelKey(tab))}</span>
              </NavTabButton>
            );
          })}
        </SegmentedTabGroup>
      </div>

      {/* Match 市场: full-bleed body; panels own px-6 gutters (no max-w). */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "uploads" ? (
          <WorkspaceFilesUploadsPanel
            client={props.client}
            workspaceId={props.workspaceId}
            workspaceRoot={props.workspaceRoot}
            onAddToTask={props.onAddToTask}
          />
        ) : (
          <WorkspaceFilesBrowserPanel
            client={props.client}
            workspaceId={props.workspaceId}
            workspaceRoot={props.workspaceRoot}
            fileRoot={props.fileRoot}
            sourceTab={activeTab === "expert" ? "expert" : "task"}
            onOpenArtifact={props.onOpenArtifact}
            onEditError={props.onEditError}
            onAddToTask={props.onAddToTask}
          />
        )}
      </div>
    </div>
  );
}
