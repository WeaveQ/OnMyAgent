/** @jsxImportSource react */
/**
 * Primary-rail Files page (P0 three-source IA + history compatibility).
 * - Uploads: inbox list + import-by-copy
 * - Task files: workspace catalog browser (historical files until provenance P1)
 * - Expert files: honest empty until write-time provenance (no mis-bucket)
 */
import { useState } from "react";
import { Bot, FileStack, FileUp } from "lucide-react";

import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { shellChrome, typeScale } from "@/react-app/design-system/type-scale";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import type { OpenTarget } from "../../capabilities/artifacts/open-target";
import {
  DEFAULT_FILES_SOURCE_TAB,
  FILES_SOURCE_TABS,
  filesSourceEmptyHintKey,
  filesSourceEmptyTitleKey,
  filesSourceTabLabelKey,
  filesSourceTabSubtitleKey,
  type FilesSourceTab,
} from "./workspace-files-model";
import { WorkspaceFilesBrowserPanel } from "./workspace-files-browser-panel";
import { WorkspaceFilesUploadsPanel } from "./workspace-files-uploads-panel";

// Re-export pure root resolver for existing callers/tests.
export { resolveToolWorkspaceFileRoot } from "./workspace-files-model";

function filesSourceTabIcon(tab: FilesSourceTab) {
  switch (tab) {
    case "uploads":
      return FileUp;
    case "task":
      return FileStack;
    case "expert":
      return Bot;
  }
}

/** Expert tab: no provenance yet — do not list untagged history as expert files. */
function FilesExpertPendingEmpty() {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col">
      <div className="mb-4 shrink-0">
        <h1 className={typeScale.pageTitle}>{t("files.title")}</h1>
        <p className={cn(typeScale.pageSubtitle, "mt-1")}>
          {t(filesSourceTabSubtitleKey("expert"))}
        </p>
      </div>
      <Empty className="min-h-[320px] flex-1 border border-dashed border-dls-border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Bot className="size-5" aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{t(filesSourceEmptyTitleKey("expert"))}</EmptyTitle>
          <EmptyDescription>
            {t(filesSourceEmptyHintKey("expert"))}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
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
          {FILES_SOURCE_TABS.map((tab) => {
            const Icon = filesSourceTabIcon(tab);
            const active = activeTab === tab;
            return (
              <NavTabButton
                key={tab}
                active={active}
                type="button"
                role="tab"
                onClick={() => setActiveTab(tab)}
                size="tab"
                shape="tab"
                aria-selected={active}
                aria-current={active ? "page" : undefined}
              >
                <Icon aria-hidden />
                <span>{t(filesSourceTabLabelKey(tab))}</span>
              </NavTabButton>
            );
          })}
        </SegmentedTabGroup>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden px-6 py-5">
        {activeTab === "uploads" ? (
          <WorkspaceFilesUploadsPanel
            client={props.client}
            workspaceId={props.workspaceId}
          />
        ) : activeTab === "task" ? (
          <WorkspaceFilesBrowserPanel
            client={props.client}
            workspaceId={props.workspaceId}
            workspaceRoot={props.workspaceRoot}
            fileRoot={props.fileRoot}
            onOpenArtifact={props.onOpenArtifact}
            onEditError={props.onEditError}
            onAddToTask={props.onAddToTask}
          />
        ) : (
          <FilesExpertPendingEmpty />
        )}
      </div>
    </div>
  );
}
