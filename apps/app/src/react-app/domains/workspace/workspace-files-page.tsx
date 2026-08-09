/** @jsxImportSource react */
/**
 * Primary-rail Files page (three-source IA).
 * Rail: Mine / Tasks / Experts / Projects (Projects coming soon, disabled)
 * - Mine: uploads/ catalog + import-by-copy + folder browse
 * - Tasks: conversation outline of non-expert workspace files
 * - Experts: conversation outline of expert agent folders
 * - Projects: not yet open
 */
import { useCallback, useState } from "react";
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
import {
  WorkspaceFilesUploadsPanel,
  type WorkspaceFilesToastInput,
} from "./workspace-files-uploads-panel";

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

function readFilesTabFromUrl(): FilesSourceTab {
  if (typeof window === "undefined") return DEFAULT_FILES_SOURCE_TAB;
  const tab = new URLSearchParams(window.location.search).get("tab");
  if (tab === "uploads" || tab === "task" || tab === "expert") return tab;
  return DEFAULT_FILES_SOURCE_TAB;
}

function writeFilesTabToUrl(tab: FilesSourceTab) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (tab === DEFAULT_FILES_SOURCE_TAB) {
    url.searchParams.delete("tab");
  } else {
    url.searchParams.set("tab", tab);
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function WorkspaceFilesPage(props: {
  active?: boolean;
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  workspaceRoot: string;
  /** Directory to list; callers pass the selected OnMyAgent workspace root. */
  fileRoot?: string | null;
  activeSessionIds?: ReadonlySet<string> | readonly string[] | null;
  archivedSessionIds?: ReadonlySet<string> | readonly string[] | null;
  sessionTitleByKey?: ReadonlyMap<string, string> | Record<string, string> | null;
  sessionIdByPathKey?: ReadonlyMap<string, string> | Record<string, string> | null;
  onOpenSourceSession?: (sessionId: string) => void;
  onOpenArtifact?: (target: OpenTarget) => Promise<void> | void;
  onEditError?: () => void;
  onAddToTask?: (relativePath: string) => void;
  onAskAgentAboutFile?: (input: {
    path: string;
    name: string;
    preview: string;
  }) => void;
  onToast?: (input: WorkspaceFilesToastInput) => void;
}) {
  const [activeTab, setActiveTab] = useState<FilesSourceTab>(() =>
    readFilesTabFromUrl(),
  );

  const selectTab = useCallback((tab: FilesSourceTab) => {
    setActiveTab(tab);
    writeFilesTabToUrl(tab);
  }, []);

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
                  selectTab(tab);
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

      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "uploads" ? (
          <WorkspaceFilesUploadsPanel
            active={props.active}
            client={props.client}
            workspaceId={props.workspaceId}
            workspaceRoot={props.workspaceRoot}
            onAddToTask={props.onAddToTask}
            onAskAgentAboutFile={props.onAskAgentAboutFile}
            onToast={props.onToast}
          />
        ) : (
          <WorkspaceFilesBrowserPanel
            active={props.active}
            client={props.client}
            workspaceId={props.workspaceId}
            workspaceRoot={props.workspaceRoot}
            fileRoot={props.fileRoot}
            sourceTab={activeTab === "expert" ? "expert" : "task"}
            activeSessionIds={props.activeSessionIds}
            archivedSessionIds={props.archivedSessionIds}
            sessionTitleByKey={props.sessionTitleByKey}
            sessionIdByPathKey={props.sessionIdByPathKey}
            onOpenSourceSession={props.onOpenSourceSession}
            onOpenArtifact={props.onOpenArtifact}
            onEditError={props.onEditError}
            onAddToTask={props.onAddToTask}
            onAskAgentAboutFile={props.onAskAgentAboutFile}
          />
        )}
      </div>
    </div>
  );
}
