/** @jsxImportSource react */
import { useState } from "react";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { NoticeBox } from "@/components/ui/notice-box";
import { t } from "../../../i18n";
import { KnowledgeRecentView } from "./knowledge-recent-view";
import {
  KnowledgeVaultGroups,
  type KnowledgeVaultItem,
  type KnowledgeVaultSelection,
} from "./knowledge-vault-groups";
import type { KnowledgeRecentEntry } from "../../../app/lib/desktop-knowledge";
import type { KnowledgeNoteRef, KnowledgeVaultScope } from "./knowledge-vault-model";
import { KnowledgeVaultToolbar } from "./knowledge-vault-toolbar";
import { KnowledgeVaultTree, type KnowledgeTreeActions } from "./knowledge-vault-tree";
import { readKnowledgeTreeSort, writeKnowledgeTreeSort } from "./knowledge-vault-tree-sort";
import type { KnowledgeVaultFile } from "./knowledge-vault-model";

type KnowledgeVaultSidebarProps = {
  scope: KnowledgeVaultScope;
  workspaceId?: string;
  expertId?: string;
  indexing: boolean;
  indexNotice?: { tone: "success" | "error"; title: string } | null;
  error: string | null;
  loading: boolean;
  showRecent: boolean;
  visibleFiles: readonly KnowledgeVaultFile[];
  query: string;
  selected: KnowledgeNoteRef | null;
  userVaults: readonly KnowledgeVaultItem[];
  activeVaultPath: string | null;
  treeActions: KnowledgeTreeActions;
  expandNonce: number;
  collapseNonce: number;
  revealNonce: number;
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
  onSelectVault: (selection: KnowledgeVaultSelection) => void;
  onVaultsChanged: () => void;
  onOpenNote: (note: KnowledgeNoteRef) => void;
  scopeForRecent: (entry: KnowledgeRecentEntry) => string;
};

export function KnowledgeVaultSidebar(props: KnowledgeVaultSidebarProps) {
  const [sortKey, setSortKey] = useState(readKnowledgeTreeSort);
  const [allExpanded, setAllExpanded] = useState(false);
  return (
    <aside className="row-span-2 flex min-h-0 flex-col overflow-hidden border-r border-dls-border">
      <KnowledgeVaultToolbar
        scope={props.scope}
        workspaceId={props.workspaceId}
        expertId={props.expertId}
        indexing={props.indexing}
        sortKey={sortKey}
        allExpanded={allExpanded}
        onNewNote={props.onNewNote}
        onNewCsv={props.onNewCsv}
        onNewFolder={props.onNewFolder}
        onNewLink={props.onNewLink}
        onUploaded={props.onUploaded}
        onOpenFolder={props.onOpenFolder}
        onToggleExpand={() => {
          if (allExpanded) props.onCollapseAll();
          else props.onExpandAll();
        }}
        onSortKeyChange={(key) => {
          setSortKey(key);
          writeKnowledgeTreeSort(key);
        }}
        onToggleRecent={props.onToggleRecent}
        onRebuildIndex={props.onRebuildIndex}
      />
      {props.indexing || props.indexNotice || props.error ? (
        <div className="space-y-2 px-2 pt-2">
          {props.indexing ? (
            <NoticeBox tone="info">{t("knowledge.index_running")}</NoticeBox>
          ) : props.indexNotice ? (
            <NoticeBox tone={props.indexNotice.tone === "error" ? "error" : "info"}>
              {props.indexNotice.title}
            </NoticeBox>
          ) : null}
          {!props.indexing && props.error ? (
            <NoticeBox tone="error">{props.error}</NoticeBox>
          ) : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {props.loading ? (
          <div className="flex h-full items-center justify-center">
            <LoadingSpinner />
          </div>
        ) : props.showRecent ? (
          <KnowledgeRecentView
            onOpenNote={props.onOpenNote}
            scopeFor={props.scopeForRecent}
          />
        ) : props.visibleFiles.length === 0 && props.query.trim() ? (
          <div className="px-3 py-8 text-center text-sm text-dls-secondary">
            {t("knowledge.no_results")}
          </div>
        ) : (
          <KnowledgeVaultTree
            files={props.visibleFiles}
            scope={props.scope}
            selected={props.selected}
            onSelect={props.onOpenNote}
            actions={props.treeActions}
            sortKey={sortKey}
            expandNonce={props.expandNonce}
            collapseNonce={props.collapseNonce}
            revealNonce={props.revealNonce}
            onAllExpandedChange={setAllExpanded}
          />
        )}
      </div>
      <div className="max-h-48 shrink-0 overflow-y-auto border-t border-dls-border px-1 py-1">
        <KnowledgeVaultGroups
          active={{
            scope: props.scope,
            vaultPath: props.scope === "user" ? props.activeVaultPath : undefined,
          }}
          userVaults={props.userVaults}
          projectUnavailable={!props.workspaceId}
          expertUnavailable={!props.expertId}
          onSelect={props.onSelectVault}
          onChanged={props.onVaultsChanged}
        />
      </div>
    </aside>
  );
}
