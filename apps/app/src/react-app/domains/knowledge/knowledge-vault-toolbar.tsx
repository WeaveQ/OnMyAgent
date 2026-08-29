/** @jsxImportSource react */
import {
  ChevronsDown,
  ChevronsUp,
  Clock,
  FolderOpen,
  RefreshCw,
} from "lucide-react";

import { ToolbarIconButton } from "./knowledge-vault-toolbar-button";
import { KnowledgeNewMenu } from "./knowledge-new-menu";
import { t } from "../../../i18n";
import type { KnowledgeVaultScope } from "./knowledge-vault-model";

type KnowledgeVaultToolbarProps = {
  scope: KnowledgeVaultScope;
  workspaceId?: string;
  expertId?: string;
  indexing: boolean;
  onNewNote: () => void;
  onNewCsv: () => void;
  onNewFolder: () => void;
  onNewLink: () => void;
  onUploaded: () => void;
  onOpenFolder: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onToggleRecent: () => void;
  onRebuildIndex: () => void;
};

export function KnowledgeVaultToolbar(props: KnowledgeVaultToolbarProps) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-0.5 px-2 text-dls-secondary mac:titlebar-no-drag">
      <KnowledgeNewMenu
        scope={props.scope}
        workspaceId={props.workspaceId}
        expertId={props.expertId}
        onNewNote={props.onNewNote}
        onNewCsv={props.onNewCsv}
        onNewFolder={props.onNewFolder}
        onNewLink={props.onNewLink}
        onUploaded={props.onUploaded}
      />
      <span className="mx-0.5 h-3.5 w-px shrink-0 bg-dls-border" aria-hidden />
      <ToolbarIconButton
        label={t("knowledge.open_folder")}
        hint={t("knowledge.toolbar_open_folder")}
        onClick={props.onOpenFolder}
      >
        <FolderOpen className="size-3.5" strokeWidth={1.75} />
      </ToolbarIconButton>
      <span className="mx-0.5 h-3.5 w-px shrink-0 bg-dls-border" aria-hidden />
      <ToolbarIconButton
        label={t("knowledge.expand_all")}
        hint={t("knowledge.toolbar_expand_all")}
        onClick={props.onExpandAll}
      >
        <ChevronsDown className="size-3.5" strokeWidth={1.75} />
      </ToolbarIconButton>
      <ToolbarIconButton
        label={t("knowledge.collapse_all")}
        hint={t("knowledge.toolbar_collapse_all")}
        onClick={props.onCollapseAll}
      >
        <ChevronsUp className="size-3.5" strokeWidth={1.75} />
      </ToolbarIconButton>
      <span className="mx-0.5 h-3.5 w-px shrink-0 bg-dls-border" aria-hidden />
      <ToolbarIconButton
        label={t("knowledge.recent_title")}
        hint={t("knowledge.recent_title")}
        onClick={props.onToggleRecent}
      >
        <Clock className="size-3.5" strokeWidth={1.75} />
      </ToolbarIconButton>
      <span className="mx-0.5 h-3.5 w-px shrink-0 bg-dls-border" aria-hidden />
      <ToolbarIconButton
        label={t("knowledge.sync_index")}
        hint={t("knowledge.toolbar_sync_index")}
        disabled={props.indexing}
        onClick={props.onRebuildIndex}
      >
        <RefreshCw
          className={`size-3.5 ${props.indexing ? "animate-spin" : ""}`}
          strokeWidth={1.75}
        />
      </ToolbarIconButton>
    </div>
  );
}
