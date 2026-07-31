/** @jsxImportSource react */
/**
 * Primary-rail Files page (P0 three-source IA).
 * Uploads: inbox list + import-by-copy.
 * Task / Expert: honest empty until write-time provenance (P1).
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

/** Honest empty for tabs without write-time provenance (P0). */
function FilesSourcePendingEmpty(props: { tab: FilesSourceTab }) {
  const Icon = props.tab === "expert" ? Bot : FileStack;
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col">
      <div className="mb-4 shrink-0">
        <h1 className={typeScale.pageTitle}>{t("files.title")}</h1>
        <p className={cn(typeScale.pageSubtitle, "mt-1")}>
          {t(filesSourceTabSubtitleKey(props.tab))}
        </p>
      </div>
      <Empty className="min-h-[320px] flex-1 border border-dashed border-dls-border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon className="size-5" aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{t(filesSourceEmptyTitleKey(props.tab))}</EmptyTitle>
          <EmptyDescription>
            {t(filesSourceEmptyHintKey(props.tab))}
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
   * folder (`workspaceRoot`). Kept for API compatibility with session hosts.
   */
  fileRoot?: string | null;
  onOpenArtifact?: (target: OpenTarget) => Promise<void> | void;
  onEditError?: () => void;
  /** Optional: attach file into a new/current task (composer). */
  onAddToTask?: (relativePath: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<FilesSourceTab>(
    DEFAULT_FILES_SOURCE_TAB,
  );

  // Keep props referenced so host APIs stay stable for P1 browser restore.
  void props.workspaceRoot;
  void props.fileRoot;
  void props.onOpenArtifact;
  void props.onEditError;
  void props.onAddToTask;

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
        ) : (
          <FilesSourcePendingEmpty tab={activeTab} />
        )}
      </div>
    </div>
  );
}
